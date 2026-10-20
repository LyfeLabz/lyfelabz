import { TOPIC_LABEL, type LessonTopic } from "../../curriculum/curriculumManifest";
import { buildLessonBasePath } from "../../assignments/studentList/launch";
import { attachDeliveryNewTabPreparation } from "../../assignments/studentList/deliveryNavigation";

// Teacher Units UX Milestone 1: the shared full-width resource card. One
// presentation layer for every resource row a teacher sees: Curriculum
// lessons, Curriculum resource tabs (investigations, simulations,
// extensions, challenges), and the resources inside a My Units unit. It owns
// only the visual structure:
//
//   card (.shell-resource-row, one per row)
//     main     grade / topic badges, resource type, title, optional status
//     actions  context-specific controls, supplied by the caller
//     footer   optional full-width region, appended by the caller
//
// It holds no resource or assignment state and performs no action. Each
// surface keeps its own controls and behavior (Assign, Preview, View Summary,
// Resources, Open, Move, Remove) and places them into `actions`, so there is
// still exactly one assignment workflow (Curriculum's) and one membership
// workflow (the units controller). The optional status line is where a
// future assignment summary ("Assigned to 2 classes") belongs, derived from
// real class assignment records by the surface that owns them.

export type ResourceCardInput = {
  // Context classes, for example "shell-card shell-lesson-card".
  readonly className: string;
  readonly tag?: "article" | "div";
  readonly grade: string | null;
  readonly topic: LessonTopic | null;
  readonly typeLabel: string | null;
  readonly title: string;
  readonly titleTag: "h3" | "h4" | "h5" | "span";
  readonly testIds?: {
    readonly grade?: string;
    readonly topic?: string;
    readonly type?: string;
    readonly title?: string;
  };
};

export type ResourceCard = {
  readonly card: HTMLElement;
  readonly main: HTMLElement;
  readonly header: HTMLElement;
  readonly titleRow: HTMLElement;
  readonly title: HTMLElement;
  readonly actions: HTMLElement;
};

export function buildResourceCard(doc: Document, input: ResourceCardInput): ResourceCard {
  const card = doc.createElement(input.tag ?? "article");
  card.className = `${input.className} shell-resource-row`;

  const main = doc.createElement("div");
  main.className = "shell-resource-row-main";
  card.appendChild(main);

  const header = doc.createElement("div");
  header.className = "shell-lesson-header";
  if (input.grade !== null) {
    const grade = doc.createElement("span");
    grade.className = "shell-lesson-badge shell-lesson-grade";
    if (input.testIds?.grade) grade.setAttribute("data-testid", input.testIds.grade);
    grade.textContent = `G${input.grade}`;
    header.appendChild(grade);
  }
  if (input.topic !== null) {
    const topic = doc.createElement("span");
    topic.className = `shell-lesson-badge shell-lesson-topic shell-lesson-topic-${input.topic}`;
    if (input.testIds?.topic) topic.setAttribute("data-testid", input.testIds.topic);
    topic.textContent = TOPIC_LABEL[input.topic];
    header.appendChild(topic);
  }
  if (input.typeLabel !== null) {
    const type = doc.createElement("span");
    type.className = "shell-lesson-resource-type";
    if (input.testIds?.type) type.setAttribute("data-testid", input.testIds.type);
    type.textContent = input.typeLabel;
    header.appendChild(type);
  }
  if (header.childElementCount > 0) main.appendChild(header);

  const titleRow = doc.createElement("div");
  titleRow.className = "shell-lesson-title-row";
  const title = doc.createElement(input.titleTag);
  title.className = "shell-lesson-title";
  if (input.testIds?.title) title.setAttribute("data-testid", input.testIds.title);
  title.textContent = input.title;
  titleRow.appendChild(title);
  main.appendChild(titleRow);

  const actions = doc.createElement("div");
  actions.className = "shell-resource-row-actions";
  card.appendChild(actions);

  return { card, main, header, titleRow, title, actions };
}

// The optional informational status line beneath the title. `null` removes
// it, so a card without a status carries no empty element.
export function setResourceCardStatus(card: ResourceCard, text: string | null): void {
  const existing = card.main.querySelector<HTMLElement>(":scope > .shell-resource-row-status");
  if (text === null) {
    existing?.remove();
    return;
  }
  const status = existing ?? card.main.ownerDocument.createElement("p");
  status.className = "shell-resource-row-status";
  if (status.textContent !== text) status.textContent = text;
  if (existing === null) card.main.appendChild(status);
}

// Teacher-safe lesson Preview (Sprint 28.6D, Task 7): opens the current v2
// lesson artifact (override-aware `buildLessonBasePath`) with no
// `?assignment` query, in a new tab. The standalone v2 runtime creates no
// session, attempt, or result. Null when the slug has no lesson path.
export function buildLessonPreviewLink(
  doc: Document,
  lesson: { readonly slug: string; readonly title: string },
  testid: string,
): HTMLAnchorElement | null {
  const previewPath = buildLessonBasePath(lesson.slug);
  if (previewPath === null) return null;
  const preview = doc.createElement("a");
  preview.className = "shell-lesson-preview";
  preview.setAttribute("data-testid", testid);
  preview.href = previewPath;
  preview.target = "_blank";
  preview.rel = "noopener";
  preview.textContent = "Preview";
  preview.setAttribute("aria-label", `Preview ${lesson.title} (opens in a new tab)`);
  // Policy E cache transition: a plain click prepares the `/app/lessons/**`
  // target before the new tab loads it (deliveryNavigation.ts). The link
  // itself is unchanged, so modified clicks keep native behavior.
  const view = doc.defaultView;
  if (view !== null) attachDeliveryNewTabPreparation(preview, view);
  return preview;
}

// The Open link of a non-lesson resource: its existing public page, in a new
// tab.
export function buildResourceOpenLink(
  doc: Document,
  href: string,
  accessibleLabel: string,
  testid: string,
): HTMLAnchorElement {
  const open = doc.createElement("a");
  open.className = "shell-lesson-resource-open";
  open.setAttribute("data-testid", testid);
  open.href = href;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Open";
  open.setAttribute("aria-label", accessibleLabel);
  return open;
}
