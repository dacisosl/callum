// 설문 섹션의 순수 로직: 설문 정리, 응답 검증, 결과 집계, CSV. 저장소·화면과 무관해 따로 시험합니다.
// 서버 함수 submit_survey_response(supabase/schema.sql)도 같은 한도와 규칙으로 다시 검사합니다.
import type { BoardColumn, ColumnSurvey, SurveyAnswers, SurveyQuestion, SurveyQuestionType, SurveyResponse } from "./board-types";

export const MAX_SURVEY_QUESTIONS = 30;
export const MAX_SURVEY_OPTIONS = 20;
export const MAX_SURVEY_TITLE = 200;
export const MAX_SURVEY_OPTION = 100;
export const MAX_SURVEY_DESCRIPTION = 500;
export const MAX_TEXT_ANSWER = 1000;

export const SURVEY_TYPES: { value: SurveyQuestionType; label: string; hint: string }[] = [
  { value: "single", label: "객관식", hint: "하나만 고르기" },
  { value: "multiple", label: "복수 선택", hint: "여러 개 고르기" },
  { value: "text", label: "단답형", hint: "글로 답하기" },
];

export function surveyTypeLabel(type: SurveyQuestionType) {
  return SURVEY_TYPES.find((item) => item.value === type)?.label ?? type;
}

// 설문이 있는 칼럼인지. 질문이 하나도 없으면 설문으로 보지 않습니다.
export function columnSurvey(column?: BoardColumn | null): ColumnSurvey | null {
  const survey = column?.survey;
  return survey && Array.isArray(survey.questions) && survey.questions.length ? survey : null;
}

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

// 저장 전에 설문을 다듬습니다. 빈 질문·빈 보기는 버리고, 객관식인데 보기가 없으면 버리며, 한도를 넘는 것은 자릅니다.
// 질문과 보기의 ID 는 그대로 두어 이미 받은 응답과 계속 짝이 맞습니다.
export function cleanSurvey(survey: ColumnSurvey): ColumnSurvey {
  const questions: SurveyQuestion[] = [];
  for (const raw of survey.questions ?? []) {
    if (questions.length >= MAX_SURVEY_QUESTIONS) break;
    const title = clip(raw.title, MAX_SURVEY_TITLE);
    if (!title || !raw.id) continue;
    const type: SurveyQuestionType = raw.type === "multiple" || raw.type === "text" ? raw.type : "single";
    const seen = new Set<string>();
    const options = type === "text" ? [] : (raw.options ?? [])
      .map((option) => ({ id: option.id, label: clip(option.label, MAX_SURVEY_OPTION) }))
      .filter((option) => option.id && option.label && !seen.has(option.id) && seen.add(option.id))
      .slice(0, MAX_SURVEY_OPTIONS);
    if (type !== "text" && options.length < 1) continue;
    questions.push({ id: raw.id, type, title, options, ...(raw.required ? { required: true } : {}) });
  }
  const description = clip(survey.description, MAX_SURVEY_DESCRIPTION);
  return { ...(description ? { description } : {}), questions, ...(survey.closed ? { closed: true } : {}) };
}

// 질문 하나가 답해졌는지.
function answered(question: SurveyQuestion, value: unknown) {
  if (question.type === "multiple") return Array.isArray(value) && value.length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

// 화면에서 쓰는 검사. 문제가 있는 질문 ID 와 이유를 돌려주고, 보낼 답(설문에 없는 것은 뺀 것)도 함께 돌려줍니다.
export function validateAnswers(survey: ColumnSurvey, answers: SurveyAnswers): { errors: Record<string, string>; clean: SurveyAnswers } {
  const errors: Record<string, string> = {};
  const clean: SurveyAnswers = {};
  for (const question of survey.questions) {
    const value = answers[question.id];
    const optionIds = new Set(question.options.map((option) => option.id));
    if (question.type === "single" && typeof value === "string" && optionIds.has(value)) clean[question.id] = value;
    if (question.type === "multiple" && Array.isArray(value)) {
      const picked = [...new Set(value.filter((id) => optionIds.has(id)))];
      if (picked.length) clean[question.id] = picked;
    }
    if (question.type === "text" && typeof value === "string" && value.trim()) {
      if (value.trim().length > MAX_TEXT_ANSWER) errors[question.id] = `${MAX_TEXT_ANSWER}자까지 쓸 수 있습니다.`;
      clean[question.id] = value.trim().slice(0, MAX_TEXT_ANSWER);
    }
    if (question.required && !answered(question, clean[question.id])) errors[question.id] = "꼭 답해야 하는 질문입니다.";
  }
  if (!Object.keys(errors).length && !Object.keys(clean).length) errors._ = "하나 이상 답해 주세요.";
  return { errors, clean };
}

export interface OptionTally { id: string; label: string; count: number; ratio: number }
export interface QuestionTally {
  question: SurveyQuestion;
  // 이 질문에 답한 응답 수. 복수 선택에서 비율의 분모입니다.
  answered: number;
  options: OptionTally[];
  texts: string[];
}

// 칼럼 하나의 응답들을 질문별로 셉니다. 설문에서 지운 보기를 고른 답은 세지 않습니다.
export function tallySurvey(survey: ColumnSurvey, responses: SurveyResponse[]): { total: number; questions: QuestionTally[] } {
  const questions = survey.questions.map((question) => {
    const counts = new Map(question.options.map((option) => [option.id, 0]));
    const texts: string[] = [];
    let answeredCount = 0;
    for (const response of responses) {
      const value = response.answers[question.id];
      if (question.type === "text") {
        if (typeof value === "string" && value.trim()) { texts.push(value.trim()); answeredCount += 1; }
        continue;
      }
      const picked = (Array.isArray(value) ? value : typeof value === "string" ? [value] : []).filter((id) => counts.has(id));
      if (!picked.length) continue;
      answeredCount += 1;
      for (const id of new Set(picked)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const options = question.options.map((option) => {
      const count = counts.get(option.id) ?? 0;
      return { id: option.id, label: option.label, count, ratio: answeredCount ? count / answeredCount : 0 };
    });
    return { question, answered: answeredCount, options, texts };
  });
  return { total: responses.length, questions };
}

// 엑셀에서 바로 열리는 CSV. 한글이 깨지지 않도록 맨 앞에 BOM 을 붙입니다.
export function surveyCsv(survey: ColumnSurvey, responses: SurveyResponse[]): string {
  const cell = (value: string) => {
    // 수식으로 해석되지 않도록 =,+,-,@ 로 시작하는 값은 작은따옴표를 앞에 붙입니다.
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["응답 시각", ...survey.questions.map((question) => question.title)];
  const rows = [...responses].sort((a, b) => a.createdAt - b.createdAt).map((response) => [
    new Date(response.updatedAt || response.createdAt).toLocaleString("ko-KR"),
    ...survey.questions.map((question) => {
      const value = response.answers[question.id];
      if (question.type === "text") return typeof value === "string" ? value : "";
      const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      return ids.map((id) => question.options.find((option) => option.id === id)?.label).filter(Boolean).join(", ");
    }),
  ]);
  return "﻿" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}
