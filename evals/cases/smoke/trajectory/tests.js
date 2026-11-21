export default function grade(transcript, { helpers }) {
  return {
    called_list_alerts: helpers.calledTool(transcript, 'list_alerts'),
    used_firing_state: helpers.calledTool(transcript, 'list_alerts', { state: 'firing' }),
  };
}
