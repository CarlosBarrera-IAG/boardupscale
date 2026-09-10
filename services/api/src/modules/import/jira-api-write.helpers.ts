export interface JiraTransitionOption {
  id: string;
  name?: string;
  to?: { name?: string };
}

export function pickInProgressTransition(
  transitions: JiraTransitionOption[],
): JiraTransitionOption | null {
  if (!Array.isArray(transitions)) return null;
  return (
    transitions.find(
      (t) => t.name === 'In Progress' || t.to?.name === 'In Progress',
    ) ?? null
  );
}

export function plainTextToAdf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: text.trim() || ' ' }],
      },
    ],
  };
}

export interface CreateJiraIssueFieldsInput {
  projectKey: string;
  summary: string;
  description?: string;
  issueTypeName?: string;
}

export function buildCreateIssuePayload(input: CreateJiraIssueFieldsInput) {
  const issueTypeName = input.issueTypeName?.trim() || 'Task';
  const fields: Record<string, unknown> = {
    project: { key: input.projectKey.trim().toUpperCase() },
    summary: input.summary.trim(),
    issuetype: { name: issueTypeName },
  };
  if (input.description?.trim()) {
    fields.description = plainTextToAdf(input.description);
  }
  return { fields };
}
