"use client";

// 설문 섹션 화면: 칼럼 안의 설문 패널, 주인의 설문 편집 창, 공유받은 사람의 응답 창, 주인의 결과 창.
// 저장과 서버 호출은 board-app.tsx 가 맡고, 여기서는 그리기와 입력만 다룹니다. 로직은 lib/survey.ts 에 있습니다.
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Download,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ColumnSurvey, SurveyAnswers, SurveyQuestion, SurveyQuestionType, SurveyResponse } from "@/lib/board-types";
import {
  MAX_SURVEY_DESCRIPTION,
  MAX_SURVEY_OPTION,
  MAX_SURVEY_OPTIONS,
  MAX_SURVEY_QUESTIONS,
  MAX_SURVEY_TITLE,
  MAX_TEXT_ANSWER,
  SURVEY_TYPES,
  surveyCsv,
  surveyTypeLabel,
  tallySurvey,
  validateAnswers,
} from "@/lib/survey";

function newId(prefix: string) {
  try { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; } catch { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }
}

function blankQuestion(type: SurveyQuestionType = "single"): SurveyQuestion {
  return { id: newId("q"), type, title: "", options: type === "text" ? [] : [{ id: newId("o"), label: "" }, { id: newId("o"), label: "" }] };
}

// 칼럼 안에 보이는 설문 패널. 주인에게는 응답 수와 결과·편집 버튼, 공유받은 사람에게는 참여 버튼이 보입니다.
export function SurveyPanel({ survey, owner, responseCount, responsesUnavailable, answered, onAnswer, onResults, onEdit }: {
  survey: ColumnSurvey;
  owner: boolean;
  responseCount: number | null;
  responsesUnavailable: boolean;
  answered: boolean;
  onAnswer: () => void;
  onResults: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="survey-panel">
      <span className="survey-panel-label"><ClipboardList aria-hidden="true" />설문 · 질문 {survey.questions.length}개{survey.closed && <em><Lock aria-hidden="true" />마감</em>}</span>
      {survey.description && <p>{survey.description}</p>}
      {owner ? (
        <>
          <span className="survey-panel-count">{responsesUnavailable ? "응답 표가 아직 없습니다 · 공유 설정에서 SQL 을 넣으세요" : responseCount === null ? "응답 수 세는 중" : <>응답 <b>{responseCount}</b>명</>}</span>
          <div className="survey-panel-actions">
            <button type="button" className="primary-button" onClick={onResults}><BarChart3 aria-hidden="true" />결과 보기</button>
            <button type="button" className="secondary-button" onClick={onEdit}><Pencil aria-hidden="true" />편집</button>
          </div>
        </>
      ) : survey.closed ? (
        <span className="survey-panel-count">응답이 마감되었습니다.</span>
      ) : answered ? (
        <div className="survey-panel-done">
          <span><CheckCircle2 aria-hidden="true" />응답했습니다</span>
          <button type="button" className="text-button" onClick={onAnswer}>응답 고치기</button>
        </div>
      ) : (
        <button type="button" className="primary-button survey-panel-join" onClick={onAnswer}><ClipboardList aria-hidden="true" />설문 참여하기</button>
      )}
    </div>
  );
}

// 주인의 설문 편집 창.
export function SurveyEditorDialog({ open, columnTitle, initial, existing, responseCount, onClose, onSave, onRemove }: {
  open: boolean;
  columnTitle: string;
  initial: ColumnSurvey;
  existing: boolean;
  responseCount: number;
  onClose: () => void;
  onSave: (survey: ColumnSurvey) => void;
  onRemove: () => void;
}) {
  // 창을 열 때마다 새로 만들어지도록 부르는 쪽에서 key 를 바꿉니다. 그래서 초기값을 그대로 씁니다.
  const [draft, setDraft] = useState<ColumnSurvey>(() => (initial.questions.length ? structuredClone(initial) : { ...initial, questions: [blankQuestion()] }));

  const updateQuestion = (id: string, change: (question: SurveyQuestion) => SurveyQuestion) =>
    setDraft((current) => ({ ...current, questions: current.questions.map((question) => question.id === id ? change(question) : question) }));
  const moveQuestion = (index: number, delta: number) => setDraft((current) => {
    const questions = [...current.questions];
    const target = index + delta;
    if (target < 0 || target >= questions.length) return current;
    [questions[index], questions[target]] = [questions[target], questions[index]];
    return { ...current, questions };
  });
  const setType = (question: SurveyQuestion, type: SurveyQuestionType) => updateQuestion(question.id, (item) => ({
    ...item,
    type,
    // 단답형에서 객관식으로 바꾸면 빈 보기 두 개로 시작합니다. 보기는 지우지 않고 남겨 두어 되돌릴 수 있게 합니다.
    options: type !== "text" && item.options.length === 0 ? [{ id: newId("o"), label: "" }, { id: newId("o"), label: "" }] : item.options,
  }));

  const filled = draft.questions.filter((question) => question.title.trim() && (question.type === "text" || question.options.some((option) => option.label.trim())));

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="survey-dialog survey-editor">
        <DialogHeader>
          <DialogTitle>{existing ? "설문 편집" : "설문 섹션 만들기"}</DialogTitle>
          <DialogDescription>{columnTitle} 칼럼 맨 위에 설문이 놓입니다. 공유 링크로 들어온 사람이 익명으로 응답하고, 결과는 선생님만 봅니다.</DialogDescription>
        </DialogHeader>
        <div className="survey-body">
          <label className="survey-field">안내 문구 (선택)
            <textarea value={draft.description ?? ""} maxLength={MAX_SURVEY_DESCRIPTION} rows={2} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="예: 오늘 연수에 대한 의견을 들려주세요." />
          </label>

          <ol className="survey-questions">
            {draft.questions.map((question, index) => (
              <li key={question.id} className="survey-question-edit">
                <div className="survey-question-top">
                  <span className="survey-question-no">{index + 1}</span>
                  <input value={question.title} maxLength={MAX_SURVEY_TITLE} onChange={(event) => updateQuestion(question.id, (item) => ({ ...item, title: event.target.value }))} placeholder="질문을 입력하세요" aria-label={`${index + 1}번 질문`} autoFocus={index === draft.questions.length - 1 && !question.title} />
                  <div className="survey-question-tools">
                    <button type="button" onClick={() => moveQuestion(index, -1)} disabled={index === 0} aria-label="위로" title="위로"><ArrowUp aria-hidden="true" /></button>
                    <button type="button" onClick={() => moveQuestion(index, 1)} disabled={index === draft.questions.length - 1} aria-label="아래로" title="아래로"><ArrowDown aria-hidden="true" /></button>
                    <button type="button" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((item) => item.id !== question.id) })} disabled={draft.questions.length === 1} aria-label="질문 삭제" title="질문 삭제"><Trash2 aria-hidden="true" /></button>
                  </div>
                </div>
                <div className="survey-type-row" role="radiogroup" aria-label={`${index + 1}번 질문 형태`}>
                  {SURVEY_TYPES.map((type) => (
                    <button key={type.value} type="button" role="radio" aria-checked={question.type === type.value} className={question.type === type.value ? "is-active" : undefined} onClick={() => setType(question, type.value)} title={type.hint}>{type.label}</button>
                  ))}
                  <label className="survey-required"><input type="checkbox" checked={Boolean(question.required)} onChange={(event) => updateQuestion(question.id, (item) => ({ ...item, required: event.target.checked || undefined }))} />필수</label>
                </div>
                {question.type === "text" ? (
                  <p className="survey-text-hint">응답자가 {MAX_TEXT_ANSWER}자까지 글로 답합니다.</p>
                ) : (
                  <div className="survey-options-edit">
                    {question.options.map((option, optionIndex) => (
                      <div key={option.id} className="survey-option-edit">
                        <span className={`survey-mark ${question.type === "multiple" ? "is-check" : "is-radio"}`} aria-hidden="true" />
                        <input value={option.label} maxLength={MAX_SURVEY_OPTION} onChange={(event) => updateQuestion(question.id, (item) => ({ ...item, options: item.options.map((entry) => entry.id === option.id ? { ...entry, label: event.target.value } : entry) }))} placeholder={`보기 ${optionIndex + 1}`} aria-label={`${index + 1}번 질문 보기 ${optionIndex + 1}`} />
                        <button type="button" onClick={() => updateQuestion(question.id, (item) => ({ ...item, options: item.options.filter((entry) => entry.id !== option.id) }))} disabled={question.options.length <= 1} aria-label="보기 삭제" title="보기 삭제"><X aria-hidden="true" /></button>
                      </div>
                    ))}
                    {question.options.length < MAX_SURVEY_OPTIONS && <button type="button" className="text-button survey-add-option" onClick={() => updateQuestion(question.id, (item) => ({ ...item, options: [...item.options, { id: newId("o"), label: "" }] }))}><Plus aria-hidden="true" />보기 추가</button>}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {draft.questions.length < MAX_SURVEY_QUESTIONS && <button type="button" className="secondary-button survey-add-question" onClick={() => setDraft({ ...draft, questions: [...draft.questions, blankQuestion()] })}><Plus aria-hidden="true" />질문 추가</button>}

          <label className="survey-closed-row"><input type="checkbox" checked={Boolean(draft.closed)} onChange={(event) => setDraft({ ...draft, closed: event.target.checked || undefined })} /><span><b>응답 마감</b> · 켜면 더 이상 응답을 받지 않습니다. 결과는 그대로 남습니다.</span></label>
          {existing && responseCount > 0 && <p className="survey-note">이미 응답 {responseCount}개가 있습니다. 보기를 지우면 그 보기를 고른 응답은 결과에서 빠지고, 질문 문구를 바꾸면 바뀐 문구로 보입니다.</p>}
        </div>
        <DialogFooter className="survey-footer">
          {existing && <button type="button" className="text-button survey-remove" onClick={onRemove}>설문 해제</button>}
          <button type="button" className="secondary-button" onClick={onClose}>취소</button>
          <button type="button" className="primary-button" onClick={() => onSave(draft)} disabled={!filled.length}>저장</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 공유받은 사람의 응답 창. 이미 응답했으면 그 답으로 채워져 고칠 수 있습니다.
export function SurveyAnswerDialog({ open, columnTitle, survey, initial, submitting, onClose, onSubmit }: {
  open: boolean;
  columnTitle: string;
  survey: ColumnSurvey;
  initial: SurveyAnswers;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (answers: SurveyAnswers) => void;
}) {
  const [answers, setAnswers] = useState<SurveyAnswers>(() => structuredClone(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editing = Object.keys(initial).length > 0;

  function submit() {
    const result = validateAnswers(survey, answers);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      // 첫 번째 문제 질문으로 스크롤합니다.
      const first = survey.questions.find((question) => result.errors[question.id]);
      if (first) document.getElementById(`survey-q-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    onSubmit(result.clean);
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value && !submitting) onClose(); }}>
      <DialogContent className="survey-dialog survey-answer">
        <DialogHeader>
          <DialogTitle>{columnTitle}</DialogTitle>
          <DialogDescription>{survey.description || "익명 설문입니다. 이름은 받지 않습니다."}</DialogDescription>
        </DialogHeader>
        <div className="survey-body">
          {survey.questions.map((question, index) => {
            const value = answers[question.id];
            return (
              <div key={question.id} id={`survey-q-${question.id}`} role="group" aria-labelledby={`survey-q-${question.id}-title`} className={`survey-question-answer${errors[question.id] ? " has-error" : ""}`}>
                <div className="survey-question-title" id={`survey-q-${question.id}-title`}><span>{index + 1}.</span> {question.title}{question.required && <em aria-label="필수">*</em>}<small>{surveyTypeLabel(question.type)}{question.type === "multiple" ? " · 여러 개 고를 수 있어요" : ""}</small></div>
                {question.type === "text" ? (
                  <textarea value={typeof value === "string" ? value : ""} maxLength={MAX_TEXT_ANSWER} rows={3} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} placeholder="답을 적어 주세요" />
                ) : (
                  <div className="survey-choices">
                    {question.options.map((option) => {
                      const checked = question.type === "multiple" ? Array.isArray(value) && value.includes(option.id) : value === option.id;
                      return (
                        <label key={option.id} className={`survey-choice${checked ? " is-checked" : ""}`}>
                          <input
                            type={question.type === "multiple" ? "checkbox" : "radio"}
                            name={`survey-${question.id}`}
                            checked={checked}
                            onChange={(event) => {
                              if (question.type === "multiple") {
                                const current = Array.isArray(value) ? value : [];
                                setAnswers({ ...answers, [question.id]: event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id) });
                              } else setAnswers({ ...answers, [question.id]: option.id });
                            }}
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {errors[question.id] && <p className="survey-error">{errors[question.id]}</p>}
              </div>
            );
          })}
          {errors._ && <p className="survey-error">{errors._}</p>}
        </div>
        <DialogFooter className="survey-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>취소</button>
          <button type="button" className="primary-button" onClick={submit} disabled={submitting}>{submitting && <LoaderCircle className="spin" aria-hidden="true" />}{editing ? "응답 고치기" : "제출"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 주인의 결과 창. 객관식은 가로 막대, 단답형은 답 목록입니다.
export function SurveyResultsDialog({ open, columnTitle, survey, responses, loading, unavailable, onClose, onRefresh, onClear }: {
  open: boolean;
  columnTitle: string;
  survey: ColumnSurvey;
  responses: SurveyResponse[];
  loading: boolean;
  unavailable: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const { total, questions } = tallySurvey(survey, responses);

  function download() {
    const blob = new Blob([surveyCsv(survey, responses)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${columnTitle.replace(/[\\/:*?"<>|]/g, "_") || "설문"} 결과.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="survey-dialog survey-results">
        <DialogHeader>
          <DialogTitle>{columnTitle} 결과</DialogTitle>
          <DialogDescription>{unavailable ? "응답 표가 아직 없습니다. 공유 설정 창의 SQL 복사로 설문 SQL 을 넣으면 응답을 받을 수 있습니다." : <>응답 <b>{total}</b>명{survey.closed ? " · 마감됨" : ""} · 선생님만 볼 수 있습니다</>}</DialogDescription>
        </DialogHeader>
        <div className="survey-toolbar">
          <button type="button" className="secondary-button" onClick={onRefresh} disabled={loading}><RefreshCw aria-hidden="true" className={loading ? "spin" : undefined} />새로 고침</button>
          <button type="button" className="secondary-button" onClick={download} disabled={!total}><Download aria-hidden="true" />CSV 내려받기</button>
          <button type="button" className="text-button survey-clear" onClick={onClear} disabled={!total}><Trash2 aria-hidden="true" />응답 모두 지우기</button>
        </div>
        <div className="survey-body">
          {questions.map((item, index) => (
            <section key={item.question.id} className="survey-result">
              <h3><span>{index + 1}.</span> {item.question.title}</h3>
              <p className="survey-result-meta">{surveyTypeLabel(item.question.type)} · 응답 {item.answered}명{item.question.type === "multiple" ? " · 비율은 이 질문에 답한 사람 기준" : ""}</p>
              {item.question.type === "text" ? (
                item.texts.length ? <ul className="survey-texts">{item.texts.map((text, textIndex) => <li key={textIndex}>{text}</li>)}</ul> : <p className="survey-empty">아직 답이 없습니다.</p>
              ) : (
                <ul className="survey-bars">
                  {item.options.map((option) => {
                    const percent = Math.round(option.ratio * 100);
                    return (
                      <li key={option.id} title={`${option.label}: ${option.count}명 (${percent}%)`}>
                        <div className="survey-bar-label"><span>{option.label}</span><b>{option.count}명 <small>{percent}%</small></b></div>
                        <div className="survey-bar-track" role="img" aria-label={`${option.label} ${option.count}명, ${percent}%`}><i style={{ width: `${option.count ? Math.max(2, option.ratio * 100) : 0}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
          {!unavailable && !total && !loading && <p className="survey-empty">아직 응답이 없습니다. 보드를 공유하면 링크로 들어온 사람이 응답할 수 있습니다.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
