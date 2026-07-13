/** Central client cache — render only, never compute intelligence. */
export const state = {
  brief: null,
  market: null,
  playbook: null,
  competitors: null,
  citations: null,
  weekly: null,
  monthly: null,
  live: null,
  notifications: null,
  health: null,
  intelligenceCache: null,
  liveDeltaState: { lastId: 0, timeline: [] },
  briefRecsCache: [],
};

export function setState(key, value) {
  state[key] = value;
}
