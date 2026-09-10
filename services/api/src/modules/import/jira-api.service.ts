import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import {
  buildCreateIssuePayload,
  pickInProgressTransition,
  type CreateJiraIssueFieldsInput,
} from './jira-api-write.helpers';

export interface JiraApiCredentials {
  baseUrl: string; // e.g. https://acme.atlassian.net
  email: string;
  apiToken: string;
}

export interface JiraApiProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  projectTypeKey?: string;
  lead?: { emailAddress?: string; displayName?: string };
}

export interface JiraApiSprint {
  id: number;
  name: string;
  state: string; // 'active' | 'closed' | 'future'
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface JiraApiIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: any;
    issuetype?: { name: string };
    priority?: { name: string };
    status?: {
      name: string;
      statusCategory?: { key: string };
    };
    assignee?: { emailAddress?: string; displayName?: string };
    reporter?: { emailAddress?: string; displayName?: string };
    created?: string;
    updated?: string;
    labels?: string[];
    customfield_10016?: number; // story points
    customfield_10020?: Array<{   // sprint (array in Jira Cloud API v3)
      id: number;
      name: string;
      state: string;
      startDate?: string;
      endDate?: string;
      goal?: string;
    }>;
    timetracking?: {
      originalEstimate?: string;
      timeSpent?: string;
      originalEstimateSeconds?: number;
      timeSpentSeconds?: number;
    };
    subtasks?: Array<{ id: string; key: string }>;
    parent?: { id: string; key: string };
    comment?: {
      comments: Array<{
        author?: { emailAddress?: string; displayName?: string };
        body?: any; // Jira ADF or plain text
        created?: string;
      }>;
    };
  };
}

export interface JiraPaginatedResponse<T> {
  startAt: number;
  maxResults: number;
  total: number;
  values?: T[];    // used by board/sprint APIs
  issues?: T[];    // used by search API
}

export interface JiraTestResult {
  ok: boolean;
  displayName?: string;
  accountId?: string;
  errorMessage?: string;
}

export interface JiraCreatedIssueResult {
  id: string;
  key: string;
  self?: string;
  assigneeAccountId: string;
  transitionedToInProgress: boolean;
}

const REQUEST_DELAY_MS = 100; // courtesy delay between paginated requests
const IN_PROGRESS_STATUS_NAME = 'In Progress';

/**
 * Thin HTTP client for the Jira REST API v3.
 *
 * Uses Node's built-in http/https modules (no axios dependency) to keep the
 * service self-contained and avoid bundle bloat.
 *
 * All methods accept credentials explicitly — this service is stateless and
 * safe to use concurrently for different orgs.
 */
@Injectable()
export class JiraApiService {
  private readonly logger = new Logger(JiraApiService.name);

  private buildAuthHeader(credentials: JiraApiCredentials): string {
    return credentials.email
      ? `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64')}`
      : `Bearer ${credentials.apiToken}`;
  }

  /**
   * Low-level Jira REST call. Retries once on 429 (rate limit).
   */
  async request<T>(
    credentials: JiraApiCredentials,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    attempt = 1,
  ): Promise<T> {
    const authHeader = this.buildAuthHeader(credentials);
    const rawUrl = credentials.baseUrl.replace(/\/$/, '') + path;
    const parsedUrl = new URL(rawUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const port = parsedUrl.port
      ? parseInt(parsedUrl.port, 10)
      : isHttps
        ? 443
        : 80;

    const payload =
      body === undefined ? undefined : JSON.stringify(body);

    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => (responseBody += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode === 429 && attempt === 1) {
            setTimeout(() => {
              this.request<T>(credentials, method, path, body, 2)
                .then(resolve)
                .catch(reject);
            }, 2000);
            return;
          }

          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `Jira API ${res.statusCode}: ${responseBody.slice(0, 200)}`,
              ),
            );
            return;
          }

          if (!responseBody.trim()) {
            resolve(undefined as T);
            return;
          }

          try {
            resolve(JSON.parse(responseBody) as T);
          } catch {
            reject(
              new Error(
                `Jira API returned non-JSON: ${responseBody.slice(0, 200)}`,
              ),
            );
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Jira API request timed out (15s)'));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  private get<T>(
    credentials: JiraApiCredentials,
    path: string,
    attempt = 1,
  ): Promise<T> {
    return this.request<T>(credentials, 'GET', path, undefined, attempt);
  }

  /**
   * Verify credentials and return the authenticated user's display name.
   */
  async getMyself(
    credentials: JiraApiCredentials,
  ): Promise<{ accountId: string; displayName?: string }> {
    const result = await this.get<{ accountId: string; displayName?: string }>(
      credentials,
      '/rest/api/3/myself',
    );
    if (!result.accountId) {
      throw new Error('Jira /myself did not return accountId');
    }
    return result;
  }

  async createIssueInProgressForTokenUser(
    credentials: JiraApiCredentials,
    input: CreateJiraIssueFieldsInput,
  ): Promise<JiraCreatedIssueResult> {
    const myself = await this.getMyself(credentials);
    const created = await this.request<{ id: string; key: string; self?: string }>(
      credentials,
      'POST',
      '/rest/api/3/issue',
      buildCreateIssuePayload(input),
    );

    await this.request(
      credentials,
      'PUT',
      `/rest/api/3/issue/${encodeURIComponent(created.key)}/assignee`,
      { accountId: myself.accountId },
    );

    const transitions = await this.get<{ transitions: Array<{ id: string; name?: string; to?: { name?: string } }> }>(
      credentials,
      `/rest/api/3/issue/${encodeURIComponent(created.key)}/transitions`,
    );
    const inProgress = pickInProgressTransition(transitions.transitions ?? []);
    if (inProgress) {
      await this.request(
        credentials,
        'POST',
        `/rest/api/3/issue/${encodeURIComponent(created.key)}/transitions`,
        { transition: { id: inProgress.id } },
      );
    } else {
      this.logger.warn(
        `No "${IN_PROGRESS_STATUS_NAME}" transition for ${created.key}; issue left in default workflow state`,
      );
    }

    return {
      id: created.id,
      key: created.key,
      self: created.self,
      assigneeAccountId: myself.accountId,
      transitionedToInProgress: Boolean(inProgress),
    };
  }

  async testConnection(
    credentials: JiraApiCredentials,
  ): Promise<JiraTestResult> {
    try {
      const result = await this.get<{
        displayName?: string;
        accountId?: string;
        emailAddress?: string;
      }>(credentials, '/rest/api/3/myself');

      return {
        ok: true,
        displayName: result.displayName,
        accountId: result.accountId,
      };
    } catch (err: any) {
      return { ok: false, errorMessage: err.message };
    }
  }

  /**
   * List all projects the authenticated user can see.
   */
  async listProjects(
    credentials: JiraApiCredentials,
  ): Promise<JiraApiProject[]> {
    const PAGE_SIZE = 50;
    const projects: JiraApiProject[] = [];
    let startAt = 0;
    let hasMore = true;

    while (hasMore) {
      // action=browse returns all projects the user can see (view permission).
      // The default action=create only returns projects where the user can create
      // issues, which excludes read-only or archived projects and causes fewer
      // projects to be returned than are actually accessible.
      const page = await this.get<{ values: JiraApiProject[]; isLast: boolean }>(
        credentials,
        `/rest/api/3/project/search?startAt=${startAt}&maxResults=${PAGE_SIZE}&action=browse&expand=description,lead`,
      );

      if (Array.isArray(page.values)) {
        projects.push(...page.values);
      }

      hasMore = !page.isLast && (page.values?.length ?? 0) === PAGE_SIZE;
      startAt += PAGE_SIZE;

      if (hasMore) {
        await this.delay(REQUEST_DELAY_MS);
      }
    }

    return projects;
  }

  /**
   * Return only the total count of issues matching a JQL query.
   * Uses maxResults=0 so Jira returns just the total without any issue data.
   */
  async countIssuesByJql(
    credentials: JiraApiCredentials,
    jql: string,
  ): Promise<number> {
    const encoded = encodeURIComponent(jql);
    const path = `/rest/api/3/search?jql=${encoded}&maxResults=0&fields=key`;

    const page = await this.get<{ total: number }>(credentials, path);
    return page.total ?? 0;
  }

  /**
   * Fetch all issues for a JQL query with full pagination.
   * Uses the search API which returns up to 100 issues per page.
   */
  async fetchIssuesByJql(
    credentials: JiraApiCredentials,
    jql: string,
    onPageFetched?: (fetched: number, total: number) => void,
  ): Promise<JiraApiIssue[]> {
    const PAGE_SIZE = 100;
    const FIELDS = [
      'summary',
      'description',
      'issuetype',
      'priority',
      'status',
      'assignee',
      'reporter',
      'created',
      'updated',
      'labels',
      'customfield_10016', // story points
      'customfield_10020', // sprint
      'timetracking',
      'subtasks',
      'parent',
      'comment',
    ].join(',');

    const issues: JiraApiIssue[] = [];
    let startAt = 0;
    let total = 0;

    do {
      const encoded = encodeURIComponent(jql);
      const path =
        `/rest/api/3/search?jql=${encoded}` +
        `&startAt=${startAt}` +
        `&maxResults=${PAGE_SIZE}` +
        `&fields=${FIELDS}`;

      const page = await this.get<JiraPaginatedResponse<JiraApiIssue>>(
        credentials,
        path,
      );

      total = page.total ?? 0;

      if (Array.isArray(page.issues)) {
        issues.push(...page.issues);
      }

      startAt += PAGE_SIZE;

      if (onPageFetched) {
        onPageFetched(issues.length, total);
      }

      this.logger.debug(
        `Fetched ${issues.length}/${total} issues (JQL: ${jql.slice(0, 60)})`,
      );

      if (issues.length < total) {
        await this.delay(REQUEST_DELAY_MS);
      }
    } while (issues.length < total);

    return issues;
  }

  /**
   * Fetch all users in the Jira organisation using the users/search API.
   * Paginates with maxResults=50 until all users are retrieved.
   * Returns an array of user objects with accountId, emailAddress, and displayName.
   */
  async fetchOrgUsers(
    credentials: JiraApiCredentials,
  ): Promise<Array<{ accountId: string; emailAddress?: string; displayName?: string; active?: boolean }>> {
    const PAGE_SIZE = 50;
    const users: Array<{ accountId: string; emailAddress?: string; displayName?: string; active?: boolean }> = [];
    let startAt = 0;
    let hasMore = true;

    while (hasMore) {
      let page: Array<{ accountId: string; emailAddress?: string; displayName?: string; active?: boolean }>;
      try {
        page = await this.get<Array<{ accountId: string; emailAddress?: string; displayName?: string; active?: boolean }>>(
          credentials,
          `/rest/api/3/users/search?startAt=${startAt}&maxResults=${PAGE_SIZE}&includeInactive=false`,
        );
      } catch (err: any) {
        // Non-fatal: some Jira configurations restrict this endpoint
        this.logger.warn(`fetchOrgUsers failed at startAt=${startAt}: ${err.message}`);
        break;
      }

      if (!Array.isArray(page) || page.length === 0) {
        hasMore = false;
        break;
      }

      users.push(...page);
      hasMore = page.length === PAGE_SIZE;
      startAt += PAGE_SIZE;

      if (hasMore) {
        await this.delay(REQUEST_DELAY_MS);
      }
    }

    return users;
  }

  /**
   * Extract the description as a plain-text string.
   * Handles both Jira ADF (Atlassian Document Format) and legacy plain-text
   * description fields.
   */
  extractDescriptionText(description: any): string | null {
    if (!description) return null;
    if (typeof description === 'string') return description;

    // ADF format
    if (description.type === 'doc' && Array.isArray(description.content)) {
      return this.adfToText(description);
    }

    return null;
  }

  /**
   * Naive ADF -> plaintext conversion.
   * Preserves paragraph breaks and list items without external dependencies.
   */
  private adfToText(node: any, depth = 0): string {
    if (!node) return '';

    if (node.type === 'text') {
      return node.text || '';
    }

    if (!Array.isArray(node.content)) return '';

    const parts: string[] = node.content.map((child: any) =>
      this.adfToText(child, depth + 1),
    );

    switch (node.type) {
      case 'paragraph':
        return parts.join('') + '\n';
      case 'heading':
        return parts.join('') + '\n';
      case 'bulletList':
      case 'orderedList':
        return parts.join('');
      case 'listItem':
        return '- ' + parts.join('').trim() + '\n';
      case 'codeBlock':
        return '```\n' + parts.join('') + '```\n';
      case 'blockquote':
        return '> ' + parts.join('');
      case 'hardBreak':
        return '\n';
      default:
        return parts.join('');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
