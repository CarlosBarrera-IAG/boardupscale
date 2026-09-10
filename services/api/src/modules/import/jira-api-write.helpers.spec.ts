import {
  buildCreateIssuePayload,
  pickInProgressTransition,
  plainTextToAdf,
} from './jira-api-write.helpers';

describe('jira-api-write.helpers', () => {
  describe('pickInProgressTransition', () => {
    it('prefers a transition named In Progress', () => {
      const picked = pickInProgressTransition([
        { id: '1', name: 'To Do', to: { name: 'To Do' } },
        { id: '2', name: 'In Progress', to: { name: 'In Progress' } },
      ]);
      expect(picked?.id).toBe('2');
    });

    it('matches destination status when transition name differs', () => {
      const picked = pickInProgressTransition([
        { id: '9', name: 'Start work', to: { name: 'In Progress' } },
      ]);
      expect(picked?.id).toBe('9');
    });

    it('returns null when no In Progress transition exists', () => {
      expect(
        pickInProgressTransition([{ id: '1', name: 'Done', to: { name: 'Done' } }]),
      ).toBeNull();
    });
  });

  describe('buildCreateIssuePayload', () => {
    it('builds ADF description and defaults issue type to Task', () => {
      const payload = buildCreateIssuePayload({
        projectKey: 'itat',
        summary: ' Hello ',
        description: 'Details',
      });
      expect(payload.fields.project).toEqual({ key: 'ITAT' });
      expect(payload.fields.summary).toBe('Hello');
      expect(payload.fields.issuetype).toEqual({ name: 'Task' });
      expect(payload.fields.description).toEqual(plainTextToAdf('Details'));
    });
  });
});
