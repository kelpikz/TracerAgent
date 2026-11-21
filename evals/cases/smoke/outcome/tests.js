export default function grade(transcript, { helpers }) {
  const text = helpers.finalText(transcript);
  const sentences = text.split(/[.!?]+/).filter(part => part.trim());
  return {
    answers_question: helpers.mentions(text, /\bno (alerts are firing|firing alerts)\b/),
    is_short: sentences.length > 0 && sentences.length <= 3 && text.trim().split(/\s+/).length <= 40,
  };
}
