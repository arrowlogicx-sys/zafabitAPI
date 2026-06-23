/**
 * Simple Sentiment Analyzer utility
 * In a real-world scenario, you would use a library like 'natural' or a cloud AI API.
 */

const positiveKeywords = [
  'excellent',
  'great',
  'good',
  'satisfied',
  'perfect',
  'clean',
  'happy',
  'professional',
  'amazing',
  'best',
];
const negativeKeywords = [
  'bad',
  'poor',
  'unsatisfied',
  'dirty',
  'late',
  'rude',
  'terrible',
  'worst',
  'expensive',
  'unprofessional',
];

exports.analyzeSentiment = (text) => {
  if (!text) return 'neutral';

  const lowerText = text.toLowerCase();
  let score = 0;

  positiveKeywords.forEach((word) => {
    if (lowerText.includes(word)) score++;
  });

  negativeKeywords.forEach((word) => {
    if (lowerText.includes(word)) score--;
  });

  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
};
