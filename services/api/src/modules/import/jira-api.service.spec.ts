import { JiraApiService } from './jira-api.service';

describe('JiraApiService createIssueInProgressForTokenUser', () => {
  const credentials = {
    baseUrl: 'https://example.atlassian.net',
    email: 'bot@example.com',
    apiToken: 'token',
  };

  it('creates issue, assigns token user, and transitions to In Progress', async () => {
    const service = new JiraApiService();
    const request = jest.spyOn(service, 'request');

    request.mockImplementation(async (_creds, method, path, body) => {
      if (method === 'GET' && path === '/rest/api/3/myself') {
        return { accountId: 'acc-1', displayName: 'Bot' };
      }
      if (method === 'POST' && path === '/rest/api/3/issue') {
        expect(body).toMatchObject({
          fields: { project: { key: 'ITAT' }, summary: 'Summary' },
        });
        return { id: '10001', key: 'ITAT-99', self: 'https://x/ITAT-99' };
      }
      if (method === 'PUT' && path === '/rest/api/3/issue/ITAT-99/assignee') {
        expect(body).toEqual({ accountId: 'acc-1' });
        return undefined;
      }
      if (method === 'GET' && path === '/rest/api/3/issue/ITAT-99/transitions') {
        return {
          transitions: [{ id: 't2', name: 'In Progress', to: { name: 'In Progress' } }],
        };
      }
      if (method === 'POST' && path === '/rest/api/3/issue/ITAT-99/transitions') {
        expect(body).toEqual({ transition: { id: 't2' } });
        return undefined;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    const result = await service.createIssueInProgressForTokenUser(credentials, {
      projectKey: 'ITAT',
      summary: 'Summary',
    });

    expect(result).toEqual({
      id: '10001',
      key: 'ITAT-99',
      self: 'https://x/ITAT-99',
      assigneeAccountId: 'acc-1',
      transitionedToInProgress: true,
    });
    expect(request).toHaveBeenCalledTimes(5);
  });
});
