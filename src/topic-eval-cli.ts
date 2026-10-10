import { extractLocalTopics, isMeaningfulTopic } from "./memory.js";
import {
  evaluateTopicExtraction,
  evaluateTopicJudgement,
  formatTopicEvalReport,
  loadTopicEvalSet,
} from "./topic-eval.js";

const set = loadTopicEvalSet();
console.log(
  formatTopicEvalReport(
    evaluateTopicExtraction(set.turns, extractLocalTopics),
    evaluateTopicJudgement(set, isMeaningfulTopic),
  ),
);
