import type { TeacherUnitColor } from "../../teacherUnits/unitColor";

// Unit color selection for Create Unit and Edit Unit: a native radio group
// (arrow keys move between choices, the legend names it) over the curated
// palette plus "None" (the neutral default). Each choice shows its name next
// to a decorative swatch, so color is never the only cue. Never an
// unrestricted color picker. The palette is supplied by the panel (the
// reviewed Teacher Units consumer), so this module imports types only.

export type UnitColorPalette = {
  readonly colors: ReadonlyArray<TeacherUnitColor>;
  readonly labels: Readonly<Record<TeacherUnitColor, string>>;
};

export type UnitColorPicker = {
  readonly fieldset: HTMLFieldSetElement;
  readonly value: () => TeacherUnitColor | null;
  readonly set: (color: TeacherUnitColor | null) => void;
};

let pickerSeq = 0;

export function buildUnitColorPicker(
  doc: Document,
  testidPrefix: string,
  initial: TeacherUnitColor | null,
  palette: UnitColorPalette,
): UnitColorPicker {
  const name = `unit-color-${++pickerSeq}`;
  const fieldset = doc.createElement("fieldset");
  fieldset.className = "shell-units-color-fieldset";
  fieldset.setAttribute("data-testid", testidPrefix);
  const legend = doc.createElement("legend");
  legend.className = "shell-units-field-label";
  legend.textContent = "Unit color";
  fieldset.appendChild(legend);
  const options = doc.createElement("div");
  options.className = "shell-units-color-options";
  fieldset.appendChild(options);

  const radios: HTMLInputElement[] = [];
  const add = (value: TeacherUnitColor | null, label: string): void => {
    const key = value ?? "none";
    const option = doc.createElement("label");
    option.className = "shell-units-color-option";
    option.setAttribute("data-unit-color", key);
    const radio = doc.createElement("input");
    radio.type = "radio";
    radio.name = name;
    radio.value = key;
    radio.className = "shell-units-color-radio";
    radio.setAttribute("data-testid", `${testidPrefix}-${key}`);
    radio.checked = value === initial;
    const swatch = doc.createElement("span");
    swatch.className = "shell-units-color-swatch";
    swatch.setAttribute("aria-hidden", "true");
    const text = doc.createElement("span");
    text.className = "shell-units-color-name";
    text.textContent = label;
    option.append(radio, swatch, text);
    options.appendChild(option);
    radios.push(radio);
  };
  add(null, "None");
  for (const color of palette.colors) add(color, palette.labels[color]);

  return {
    fieldset,
    value: () => {
      const checked = radios.find((r) => r.checked);
      if (checked === undefined || checked.value === "none") return null;
      return palette.colors.find((c) => c === checked.value) ?? null;
    },
    set: (color) => {
      const key = color ?? "none";
      for (const r of radios) r.checked = r.value === key;
    },
  };
}
