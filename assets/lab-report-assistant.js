/* LyfeLabz Lab Report Assistant. Browser-local scaffold; no service or account dependency. */
(() => {
  'use strict';
  const STORAGE_KEY = 'lyfelabz:lab-report-assistant:v1';
  const outcomes = ['Supported by the results', 'Not supported by the results', 'Partially supported by the results'];
  const field = (key, label, prompt, starter, definition = '') => ({ key, label, prompt, starter, definition });
  // This schema is shared by the editor, review, Read Aloud, and print view.
  const check = (id, text, fields) => ({ id, text, fields });
  const sections = [
    { id: 'question', title: 'Investigation Question + Scientific Background', short: 'Question + Background', intro: 'Ask a testable question and record the science ideas that help you make a prediction.',
      questions: 'What will you change? What will you measure or observe?',
      checks: [
        check('question', 'My investigation question says what I am testing.', ['investigationQuestion']),
        check('background', 'My scientific background includes information that relates to my investigation.', ['scientificBackground'])
      ],
      fields: [
        field('investigationQuestion', 'Investigation Question', 'Write the question your experiment investigates.', 'How does ... affect ...?'),
        field('scientificBackground', 'Scientific Background', 'What science do you already know that relates to your investigation? Explain how those ideas could help you think about what might happen.')
      ] },
    { id: 'variables', title: 'Variables', short: 'Variables', intro: 'Identify what changes, what you measure, and what stays the same.',
      questions: 'How will you make the comparison fair?',
      checks: [
        check('independent', 'I identified what I change.', ['independentVariable']),
        check('dependent', 'I identified what I measure or observe.', ['dependentVariable']),
        check('controls', 'I identified what I keep the same.', ['controlVariables'])
      ],
      fields: [
        field('independentVariable', 'Independent Variable', 'What one factor do you change on purpose?', 'I change ...', 'The factor you deliberately change in an experiment.'),
        field('dependentVariable', 'Dependent Variable', 'What do you measure or observe in response? Include units when needed.', 'I measure ... using ...', 'The factor you measure or observe to find out how it responds.'),
        field('controlVariables', 'Control Variables', 'What factors do you keep the same between tests?', 'I keep ... the same by ...', 'Factors kept the same so you can make a fair comparison.')
      ] },
    { id: 'hypothesis', title: 'Hypothesis', short: 'Hypothesis', intro: 'Predict a result and explain why you expect it.',
      questions: 'What do you predict? Which science idea supports your prediction?',
      checks: [
        check('prediction', 'My hypothesis predicts what will happen.', ['hypothesis']),
        check('reason', 'My hypothesis gives a scientific reason for my prediction.', ['hypothesis'])
      ],
      fields: [field('hypothesis', 'Hypothesis', 'Connect your prediction to a science idea.', 'If ..., then ..., because ...', 'A testable prediction with a scientific reason.')] },
    { id: 'materials', title: 'Materials', short: 'Materials', intro: 'List the supplies someone would need to repeat your experiment.',
      questions: 'Which tools, amounts, and safety equipment did you use?',
      checks: [check('list', 'I listed the materials needed for the investigation.', ['materials'])],
      fields: [field('materials', 'Materials', 'Use one line for each item. Include quantities and units.', '- ...\n- ...')] },
    { id: 'procedure', title: 'Procedure', short: 'Procedure', intro: 'Write numbered steps in the order you carried them out.',
      questions: 'Could someone repeat your test? How did you measure and repeat trials?',
      checks: [
        check('steps', 'My procedure explains the steps of the investigation.', ['procedure']),
        check('measurement', 'My procedure includes what will be measured or observed.', ['procedure'])
      ],
      fields: [field('procedure', 'Procedure', 'Describe what you did, including measurements, repeated trials, and safe handling.', '1. ...\n2. ...\n3. ...')] },
    { id: 'data', title: 'Data & Observations', short: 'Data', intro: 'Record what happened before explaining why it happened.',
      questions: 'What did you measure? What patterns or changes did you observe?',
      checks: [
        check('results', 'My table has a title, headings, and my quantitative data.', ['quantitativeData']),
        check('observations', 'I recorded my observations or explained that none were recorded.', ['qualitativeObservations'])
      ],
      fields: [
        field('quantitativeData', 'Quantitative Data', 'Choose a table size, then add your own headings and data.', '', 'Data expressed as numbers, such as counts or measurements with units.'),
        field('qualitativeObservations', 'Qualitative Observations', 'Describe qualities or changes you observed. Never taste materials or touch unsafe substances. If none were recorded, say so.', 'During the test, I observed ...', 'Descriptions of qualities, such as color, texture, or a visible change, rather than numerical measurements.')
      ] },
    { id: 'discussion', title: 'Discussion', short: 'Discussion', intro: 'Use your results to answer the question, explain the science, and plan what comes next.',
      questions: 'What do the results support? How could you improve this experiment? What new question could you test next?',
      checks: [
        check('claim', 'I included a Claim.', ['claim']),
        check('evidence', 'I included Evidence from my results.', ['evidence']),
        check('reasoning', 'I included Reasoning.', ['reasoning']),
        check('outcome', 'I stated whether my hypothesis was supported and explained how my results show that.', ['hypothesisOutcome', 'hypothesisOutcomeExplanation']),
        check('challenge', 'I described a challenge and what I would do differently.', ['challengesImprovements']),
        check('future', 'I proposed a future experiment based on what I learned.', ['futureExperiments'])
      ],
      fields: [
        field('claim', 'Claim', 'Give a direct answer to your investigation question.', 'The results showed that ...', 'A statement that answers your investigation question.'),
        field('evidence', 'Evidence', 'Cite specific results that support your claim. Use actual numbers with units, comparisons, and/or observations.', 'In ... I measured or observed ..., compared with ...', 'Actual quantitative data or qualitative observations used to support a claim.'),
        field('reasoning', 'Reasoning', 'Explain scientifically WHY your evidence supports your claim. Connect it to a relevant scientific idea.', 'This evidence supports my claim because ...', 'The scientific explanation connecting your evidence to your claim.'),
        { key: 'hypothesisOutcome', label: 'Hypothesis Supported?', prompt: 'Compare your results with your original prediction.', options: outcomes },
        field('hypothesisOutcomeExplanation', 'Explain your answer', 'Use your results to explain why your hypothesis was supported, not supported, or partially supported.'),
        field('challengesImprovements', 'Challenges & Improvements', 'Name a challenge that could have affected your investigation. Explain what you would change to address it when repeating the SAME experiment.', 'A challenge was ... This could have affected ... If I repeated this experiment, I would ...'),
        field('futureExperiments', 'Future Experiments', 'What NEW experiment could follow from what you learned? Propose a new question or factor to investigate, rather than another fix to the same procedure.', 'Based on these results, I could next investigate ... by ...')
      ] }
  ];
  const metadata = [
    { key: 'labTitle', label: 'Lab title' },
    { key: 'studentName', label: 'Name' }
  ];
  const allFields = [...metadata, ...sections.flatMap(section => section.fields)].filter(item => item.key !== 'quantitativeData');
  const legacyCheckKeys = {
    'variables:independent': 'section-2-0', 'variables:dependent': 'section-2-1', 'variables:controls': 'section-2-2',
    'hypothesis:prediction': 'section-1-0', 'hypothesis:reason': 'section-1-1',
    'materials:list': 'section-3-0', 'procedure:steps': 'section-4-0', 'procedure:measurement': 'section-4-1',
    'data:results': 'section-5-0', 'data:observations': 'section-5-2',
    'discussion:claim': 'section-6-0', 'discussion:evidence': 'section-6-1', 'discussion:reasoning': 'section-6-2',
    'discussion:outcome': 'section-6-3', 'discussion:challenge': 'section-6-4', 'discussion:future': 'section-6-5'
  };
  const MIN_COLUMNS = 2, MAX_COLUMNS = 6, MIN_ROWS = 2, MAX_ROWS = 10;
  const emptyTable = (rows, columns) => ({ title: '', cells: Array.from({ length: rows }, () => Array(columns).fill('')) });
  const validTable = table => table && typeof table === 'object' && !Array.isArray(table) &&
    (table.title === undefined || typeof table.title === 'string') &&
    Array.isArray(table.cells) && table.cells.length >= MIN_ROWS && table.cells.length <= MAX_ROWS &&
    table.cells.every(row => Array.isArray(row) && row.length === table.cells[0].length && row.every(cell => typeof cell === 'string')) &&
    table.cells[0].length >= MIN_COLUMNS && table.cells[0].length <= MAX_COLUMNS;
  const blank = () => ({ version: 1, checkSchema: 2, responses: {}, checks: {}, quantitativeTable: null, activeSection: 'question', step: 0, settings: {} });
  const sectionIndex = key => key === 'review' ? sections.length : sections.findIndex(section => section.id === key);
  let state = blank();
  let saveBlocked = false;
  let restoredActiveSection = false;
  let loadMessage = '';
  const el = id => document.getElementById(id);
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, action, className = 'nav-back') {
    const element = node('button', text, className);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }
  function value(key) { return state.responses[key] || ''; }
  function quantitativeReady() {
    const cells = state.quantitativeTable?.cells;
    return !!cells && !!state.quantitativeTable.title.trim() && cells[0].some(cell => cell.trim()) && cells.slice(1).some(row => row.some(cell => cell.trim()));
  }
  function fieldReady(key) { return key === 'quantitativeData' ? quantitativeReady() : !!value(key).trim(); }
  function checkKey(section, item) { return `${section.id}:${item.id}`; }
  function checkReady(item) { return item.fields.every(fieldReady); }
  function missing(section) {
    const fields = section === sections[0] ? [...metadata, ...section.fields] : section.fields;
    return fields.flatMap(item => {
      if (item.key === 'hypothesisOutcomeExplanation' && !fieldReady('hypothesisOutcome')) return [];
      if (item.key === 'quantitativeData' && state.quantitativeTable) {
        if (!state.quantitativeTable.title.trim()) return [{ key: 'tableTitle', label: 'Table Title' }];
      }
      if (item.key === 'hypothesisOutcomeExplanation' && !fieldReady(item.key)) return [{ key: item.key, label: 'Hypothesis outcome explanation' }];
      return fieldReady(item.key) ? [] : [item];
    });
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (!parsed || parsed.version !== 1 || !parsed.responses || typeof parsed.responses !== 'object' || Array.isArray(parsed.responses) || (parsed.checkSchema !== undefined && parsed.checkSchema !== 2)) throw new Error('Invalid report');
      for (const item of allFields) {
        const response = parsed.responses[item.key];
        if (response !== undefined && typeof response !== 'string') throw new Error('Invalid response');
        if (item.options && response && !item.options.includes(response)) throw new Error('Invalid choice');
        state.responses[item.key] = response || '';
      }
      const oldBackground = ['backgroundKnowledge', 'backgroundConnection'].map(key => {
        const response = parsed.responses[key];
        if (response !== undefined && typeof response !== 'string') throw new Error('Invalid response');
        return response || '';
      });
      if (!state.responses.scientificBackground.trim()) {
        state.responses.scientificBackground = oldBackground.filter(response => response.trim()).join('\n\n');
      }
      if (parsed.quantitativeTable !== undefined && parsed.quantitativeTable !== null) {
        if (!validTable(parsed.quantitativeTable)) throw new Error('Invalid quantitative table');
        state.quantitativeTable = { title: parsed.quantitativeTable.title || '', cells: parsed.quantitativeTable.cells.map(row => [...row]) };
      }
      if (parsed.checks && typeof parsed.checks === 'object') {
        for (const section of sections) for (const item of section.checks) {
          const key = checkKey(section, item);
          const savedKey = parsed.checkSchema === 2 ? key : legacyCheckKeys[key];
          if (savedKey && parsed.checks[savedKey] === true && checkReady(item)) state.checks[key] = true;
        }
      }
      const restoredStep = sectionIndex(parsed.activeSection);
      if (restoredStep >= 0) {
        state.step = restoredStep;
        state.activeSection = parsed.activeSection;
        restoredActiveSection = restoredStep > 0;
      }
      for (const key of ['focus', 'large', 'contrast', 'starters']) state.settings[key] = parsed.settings?.[key] === true;
    }
  } catch (_) {
    // Do not silently overwrite unreadable or newer-version saved work.
    state = blank();
    saveBlocked = true;
    loadMessage = 'The saved report could not be opened. Saving is paused to protect it. Download any new work before leaving. Start over can clear the saved report.';
  }
  function save() {
    if (saveBlocked) return;
    try {
      const { step, ...savedReport } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedReport));
      el('save-status').textContent = '';
    } catch (_) {
      el('save-status').textContent = 'Not saved: browser storage is unavailable or full. Download your report before leaving.';
    }
  }
  function updateProgress() {
    for (const section of sections) for (const item of section.checks) {
      const key = checkKey(section, item);
      const ready = checkReady(item);
      if (!ready) delete state.checks[key];
      const checkbox = document.querySelector(`[data-check-key="${key}"]`);
      if (checkbox) {
        checkbox.disabled = !ready;
        checkbox.checked = ready && !!state.checks[key];
        checkbox.closest('label').classList.toggle('is-disabled', !ready);
      }
    }
    const count = sections.filter(section => missing(section).length === 0).length;
    el('report-progress').value = count;
    el('progress-label').textContent = `${count} of 7 sections filled in`;
    el('step-links').querySelectorAll('button').forEach((item, index) => {
      item.setAttribute('aria-current', index === state.step ? 'step' : 'false');
      const title = sections[index]?.short || 'Review & Export';
      item.textContent = `${index + 1}. ${title}${index < 7 && !missing(sections[index]).length ? ' ✓' : ''}`;
      item.setAttribute('aria-label', `${index + 1}. ${sections[index]?.title || title}${index < 7 && !missing(sections[index]).length ? ', filled in' : ''}`);
    });
  }
  function applySettings() {
    document.body.classList.toggle('focus-mode', !!state.settings.focus);
    document.documentElement.classList.toggle('large-text', !!state.settings.large);
    document.body.classList.toggle('high-contrast', !!state.settings.contrast);
    document.body.classList.toggle('hide-starters', !!state.settings.starters);
    for (const key of ['focus', 'large', 'contrast', 'starters']) el(`toggle-${key}`).setAttribute('aria-pressed', String(!!state.settings[key]));
  }
  function makeField(item, singleLine = false, headingLabel = false) {
    const wrapper = node('div', undefined, 'report-field');
    const label = node('label', item.label);
    label.htmlFor = `field-${item.key}`;
    if (headingLabel) {
      const heading = node('h3', undefined, 'background-heading');
      heading.append(label);
      wrapper.append(heading);
    } else wrapper.append(label);
    if (item.prompt) {
      const prompt = node('p', item.prompt, 'field-help');
      prompt.id = `help-${item.key}`;
      wrapper.append(prompt);
    }
    const input = node(item.options ? 'select' : singleLine ? 'input' : 'textarea');
    input.id = label.htmlFor;
    input.name = item.key;
    if (item.options) {
      const empty = node('option', 'Choose an outcome');
      empty.value = '';
      input.append(empty);
      item.options.forEach(option => input.append(node('option', option)));
    } else if (singleLine) {
      input.type = item.type || 'text';
    } else {
      input.rows = ['materials', 'procedure', 'scientificBackground'].includes(item.key) ? 5 : 3;
    }
    input.value = value(item.key);
    input.required = true;
    if (item.prompt) input.setAttribute('aria-describedby', `help-${item.key}`);
    input.addEventListener(item.options ? 'change' : 'input', () => {
      state.responses[item.key] = input.value;
      updateProgress();
      save();
    });
    wrapper.append(input);
    if (item.starter) {
      const starter = node('div', undefined, 'sentence-starter');
      starter.append(node('p', `Sentence starter: ${item.starter}`));
      starter.append(button('Use starter', () => {
        input.value = input.value.trim() ? `${input.value}\n${item.starter}` : item.starter;
        state.responses[item.key] = input.value;
        updateProgress(); save(); input.focus();
      }));
      wrapper.append(starter);
    }
    return wrapper;
  }
  const reportLabel = item => item.key === 'hypothesisOutcomeExplanation' ? 'Explanation:' : item.label;
  function dataTable(editable = false) {
    const table = node('table', undefined, 'data-table');
    table.style.setProperty('--table-columns', state.quantitativeTable.cells[0].length);
    const head = node('thead'), body = node('tbody');
    if (!editable) {
      const titleRow = node('tr');
      const titleCell = node('th', state.quantitativeTable.title.trim() || '[Table Title not entered]', 'data-table-title');
      titleCell.scope = 'colgroup';
      titleCell.colSpan = state.quantitativeTable.cells[0].length;
      titleRow.append(titleCell);
      head.append(titleRow);
    }
    state.quantitativeTable.cells.forEach((row, rowIndex) => {
      const tr = node('tr');
      row.forEach((cell, columnIndex) => {
        const td = node(rowIndex === 0 ? 'th' : 'td');
        if (rowIndex === 0) td.scope = 'col';
        if (editable) {
          const input = node(rowIndex === 0 ? 'textarea' : 'input');
          if (rowIndex === 0) input.rows = 2;
          else input.type = 'text';
          input.value = cell;
          input.setAttribute('aria-label', rowIndex === 0
            ? `Column ${columnIndex + 1} heading`
            : `Row ${rowIndex + 1}, column ${columnIndex + 1}`);
          input.dataset.tableCell = `${rowIndex}:${columnIndex}`;
          input.addEventListener('input', () => {
            state.quantitativeTable.cells[rowIndex][columnIndex] = input.value;
            updateProgress(); save();
          });
          td.append(input);
        } else td.textContent = cell || ' ';
        tr.append(td);
      });
      (rowIndex === 0 ? head : body).append(tr);
    });
    table.append(head, body);
    return table;
  }
  function tableWrap(editable = false) {
    const wrap = node('div', undefined, 'data-table-wrap');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Quantitative Data table');
    wrap.tabIndex = 0;
    wrap.append(dataTable(editable));
    return wrap;
  }
  function tableText() {
    if (!state.quantitativeTable) return '[Not answered yet]';
    return `${state.quantitativeTable.title.trim() || '[Table Title not entered]'}\n\n${state.quantitativeTable.cells.map(row => row.join('\t')).join('\n')}`;
  }
  function tableSpeech() {
    if (!state.quantitativeTable) return '';
    const [headings, ...rows] = state.quantitativeTable.cells;
    return [`Table Title: ${state.quantitativeTable.title.trim() || 'not entered'}`, `Heading row: ${headings.map((cell, index) => cell || `column ${index + 1}`).join(', ')}`,
      ...rows.map((row, index) => `Row ${index + 2}: ${row.map((cell, column) => `${headings[column] || `column ${column + 1}`}: ${cell || 'blank'}`).join(', ')}`)].join('. ');
  }
  function quantitativeField(item) {
    const wrapper = node('div', undefined, 'report-field quantitative-field');
    const heading = node('h3', item.label);
    heading.id = 'quantitative-title';
    wrapper.append(heading);
    if (!state.quantitativeTable) {
      wrapper.append(node('p', item.prompt, 'field-help'));
      const builder = node('div', undefined, 'table-builder');
      builder.setAttribute('role', 'group');
      builder.setAttribute('aria-label', 'Choose quantitative table size');
      builder.append(node('p', 'Choose columns and total rows. The first row is for your headings.', 'field-help'));
      const grid = node('div', undefined, 'table-size-grid');
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', 'Table size grid. Use arrow keys, then Enter or Space to create the table.');
      const controls = node('div', undefined, 'table-size-controls');
      const selectFor = (labelText, min, max) => {
        const label = node('label', labelText);
        const select = node('select');
        for (let value = min; value <= max; value++) {
          const option = node('option', String(value));
          option.value = String(value);
          select.append(option);
        }
        select.value = String(min);
        label.append(select);
        controls.append(label);
        return select;
      };
      const columnSelect = selectFor('Columns ', MIN_COLUMNS, MAX_COLUMNS);
      const rowSelect = selectFor('Total rows ', MIN_ROWS, MAX_ROWS);
      const status = node('p', undefined, 'table-size-status');
      status.setAttribute('aria-live', 'polite');
      let chosen = { columns: MIN_COLUMNS, rows: MIN_ROWS };
      const paint = size => {
        grid.querySelectorAll('button').forEach(cell => {
          cell.classList.toggle('selected', Number(cell.dataset.columns) <= size.columns && Number(cell.dataset.rows) <= size.rows);
          cell.tabIndex = Number(cell.dataset.columns) === chosen.columns && Number(cell.dataset.rows) === chosen.rows ? 0 : -1;
        });
        status.textContent = `${size.columns} × ${size.rows} total rows (1 heading row + ${size.rows - 1} data ${size.rows === 2 ? 'row' : 'rows'}).`;
      };
      const choose = size => {
        chosen = size;
        columnSelect.value = String(size.columns);
        rowSelect.value = String(size.rows);
        paint(chosen);
      };
      const create = size => {
        state.quantitativeTable = emptyTable(size.rows, size.columns);
        render(); save(); updateStickyOffsets();
        document.querySelector('[data-table-cell="0:0"]').focus();
      };
      for (let rows = MIN_ROWS; rows <= MAX_ROWS; rows++) for (let columns = MIN_COLUMNS; columns <= MAX_COLUMNS; columns++) {
        const cell = button('', () => create({ columns, rows }), 'table-size-cell');
        cell.dataset.columns = String(columns);
        cell.dataset.rows = String(rows);
        cell.setAttribute('aria-label', `${columns} columns, ${rows} total rows`);
        cell.addEventListener('pointerenter', () => paint({ columns, rows }));
        cell.addEventListener('focus', () => choose({ columns, rows }));
        cell.addEventListener('keydown', event => {
          const changes = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          if (!changes[event.key]) return;
          event.preventDefault();
          const [dc, dr] = changes[event.key];
          const nextColumn = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, columns + dc));
          const nextRow = Math.max(MIN_ROWS, Math.min(MAX_ROWS, rows + dr));
          grid.querySelector(`[data-columns="${nextColumn}"][data-rows="${nextRow}"]`).focus();
        });
        grid.append(cell);
      }
      grid.addEventListener('pointerleave', () => paint(chosen));
      columnSelect.addEventListener('change', () => choose({ columns: Number(columnSelect.value), rows: chosen.rows }));
      rowSelect.addEventListener('change', () => choose({ columns: chosen.columns, rows: Number(rowSelect.value) }));
      paint(chosen);
      controls.append(button('Create table', () => create(chosen)));
      builder.append(grid, status, controls);
      wrapper.append(builder);
    } else {
      const titleLabel = node('label', 'Table Title');
      titleLabel.htmlFor = 'field-tableTitle';
      const titleInput = node('input');
      titleInput.id = 'field-tableTitle';
      titleInput.type = 'text';
      titleInput.value = state.quantitativeTable.title;
      titleInput.setAttribute('aria-describedby', 'help-tableTitle');
      titleInput.addEventListener('input', () => {
        state.quantitativeTable.title = titleInput.value;
        updateProgress(); save();
      });
      const titleBox = node('div', undefined, 'data-table-title-editor');
      const titleHelp = node('p', 'Give your data table a title.', 'field-help');
      titleHelp.id = 'help-tableTitle';
      titleBox.append(titleLabel, titleHelp, titleInput);
      wrapper.append(titleBox);
      wrapper.append(node('p', 'Use the first row for headings. Include units when they are needed.', 'field-help'));
      wrapper.append(tableWrap(true));
      const controls = node('div', undefined, 'tool-controls table-edit-controls');
      const rows = state.quantitativeTable.cells.length;
      const columns = state.quantitativeTable.cells[0].length;
      const change = (action, label, disabled, populated) => {
        const control = button(label, () => {
          if (populated?.() && !window.confirm(`Remove this ${action} and its entered information?`)) return;
          const cells = state.quantitativeTable.cells;
          if (action === 'row') cells.pop();
          if (action === 'column') cells.forEach(row => row.pop());
          if (action === 'add row') cells.push(Array(cells[0].length).fill(''));
          if (action === 'add column') cells.forEach(row => row.push(''));
          render(); save(); updateStickyOffsets();
          const next = [...document.querySelectorAll('.table-edit-controls button')].find(item => item.textContent === label);
          if (next && !next.disabled) next.focus();
        });
        control.disabled = disabled;
        controls.append(control);
      };
      change('add row', 'Add row', rows >= MAX_ROWS);
      change('row', 'Remove row', rows <= MIN_ROWS, () => state.quantitativeTable.cells.at(-1).some(cell => cell.trim()));
      change('add column', 'Add column', columns >= MAX_COLUMNS);
      change('column', 'Remove column', columns <= MIN_COLUMNS, () => state.quantitativeTable.cells.some(row => row.at(-1).trim()));
      wrapper.append(controls);
    }
    return wrapper;
  }
  function checklist(section) {
    const box = node('div', undefined, 'goal-card self-check');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', `${section.id}-check-title`);
    const heading = node('h3', 'Before you move on…');
    heading.id = `${section.id}-check-title`;
    box.append(heading);
    section.checks.forEach(item => {
      const label = node('label');
      const input = node('input');
      input.type = 'checkbox';
      const key = checkKey(section, item);
      input.dataset.checkKey = key;
      input.disabled = !checkReady(item);
      input.checked = !input.disabled && !!state.checks[key];
      label.classList.toggle('is-disabled', input.disabled);
      input.addEventListener('change', () => { state.checks[key] = input.checked; save(); });
      label.append(input, node('span', item.text));
      box.append(label);
    });
    return box;
  }
  function glossary(fields) {
    const terms = fields.filter(item => item.definition);
    if (!terms.length) return null;
    const box = node('div', undefined, 'support');
    box.append(node('h3', 'Vocabulary'), node('p', terms.length === 1
      ? 'Choose the card to see what this word means.'
      : 'Choose a card to see what each word means.'));
    const grid = node('div', undefined, 'glossary-grid');
    terms.forEach(item => {
      const card = button('', () => {
        const wasOpen = card.classList.contains('open');
        grid.querySelectorAll('button').forEach(other => { other.classList.remove('open'); other.setAttribute('aria-expanded', 'false'); });
        card.classList.toggle('open', !wasOpen);
        card.setAttribute('aria-expanded', String(!wasOpen));
      }, 'glossary-card');
      card.setAttribute('aria-expanded', 'false');
      card.append(node('span', item.label, 'gc-term'), node('span', item.definition, 'gc-def'));
      grid.append(card);
    });
    box.append(grid);
    return box;
  }
  function reportArticle(print = false) {
    const article = node('article', undefined, 'report-output');
    article.append(node(print ? 'h1' : 'h3', 'Lab Report Assistant — Working Draft'));
    if (print) article.append(node('p', 'Use this organized draft to help you write your lab report.', 'draft-purpose'));
    for (const item of metadata) article.append(node('p', `${item.label}: ${value(item.key).trim() || '[Not answered yet]'}`, 'report-detail'));
    sections.forEach((section, index) => {
      const block = node('section', undefined, 'report-section goal-card');
      block.append(node(print ? 'h2' : 'h4', `${index + 1}. ${section.title}`));
      section.fields.forEach(item => {
        const entry = node('div', undefined, 'report-entry');
        entry.append(node(print ? 'h3' : 'h5', reportLabel(item)));
        if (item.key === 'quantitativeData') {
          if (state.quantitativeTable) entry.append(tableWrap());
          else entry.append(node('p', '[Not answered yet]', 'response'));
        } else entry.append(node('p', value(item.key).trim() || '[Not answered yet]', 'response'));
        block.append(entry);
      });
      if (!print) block.append(button(`Edit ${section.title}`, () => goTo(index)));
      article.append(block);
    });
    return article;
  }
  function reportText() {
    return ['Lab Report Assistant — Working Draft',
      ...metadata.map(item => `${item.label}: ${value(item.key).trim() || '[Not answered yet]'}`),
      ...sections.map((section, index) => `\n${index + 1}. ${section.title}\n${'-'.repeat(40)}\n` + section.fields.map(item => `${reportLabel(item)}\n${item.key === 'quantitativeData' ? tableText() : value(item.key).trim() || '[Not answered yet]'}`).join('\n\n'))
    ].join('\n');
  }
  function reviewOverview() {
    const missingGroups = sections.map((section, index) => ({ section, index, fields: missing(section) })).filter(group => group.fields.length);
    const missingCount = missingGroups.reduce((count, group) => count + group.fields.length, 0);
    const warning = node('p', missingCount
      ? `${missingCount} ${missingCount === 1 ? 'item is' : 'items are'} still missing. Review ${missingCount === 1 ? 'it' : 'them'} as you write your lab report. You can export your organized work now.`
      : 'All required fields contain information. You can review and export your organized work.', 'bridge-callout');
    const missingCard = node('div', undefined, 'goal-card review-summary');
    missingCard.append(node('h3', 'Missing information'));
    if (!missingGroups.length) missingCard.append(node('p', 'No required fields are blank.'));
    missingGroups.forEach(({ section, index, fields }) => {
      const group = node('div', undefined, 'review-group');
      group.append(node('h4', `${index + 1}. ${section.short}`), node('p', fields.map(item => item.label).join(', ')));
      group.append(button(`Go to ${section.short}`, () => goTo(index)));
      missingCard.append(group);
    });
    const checkCard = node('div', undefined, 'goal-card review-summary');
    checkCard.append(node('h3', 'Student self-check status'), node('p', 'Unchecked means you have not confirmed it yet. LyfeLabz has not judged your science.'));
    sections.forEach((section, index) => {
      const confirmed = section.checks.filter(item => checkReady(item) && state.checks[checkKey(section, item)]).length;
      const group = node('div', undefined, 'review-group');
      group.append(node('h4', `${index + 1}. ${section.short}: ${confirmed} of ${section.checks.length} confirmed`));
      const pending = section.checks.filter(item => !checkReady(item) || !state.checks[checkKey(section, item)]);
      if (pending.length) {
        group.append(node('p', `Not confirmed yet: ${pending.map(item => item.text).join(' ')}`));
        group.append(button(`Review ${section.short}`, () => goTo(index)));
      }
      checkCard.append(group);
    });
    return [warning, missingCard, checkCard];
  }
  function refreshPrint() { el('print-report').replaceChildren(reportArticle(true)); }
  let activeSpeech = null;
  const speechAvailable = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  function speechIdle(message = '') {
    el('read-aloud').textContent = 'Read aloud';
    el('read-aloud').setAttribute('aria-pressed', 'false');
    el('speech-status').textContent = message;
  }
  function stopSpeech() {
    // Detach callbacks before cancel: browsers can report canceled/interrupted
    // asynchronously, after a subsequent utterance has already started.
    const previous = activeSpeech;
    activeSpeech = null;
    if (previous) { previous.onend = null; previous.onerror = null; previous.onstart = null; }
    if (speechAvailable) {
      window.speechSynthesis.cancel();
      speechIdle();
    }
  }
  function readAloud() {
    if (!speechAvailable) return;
    if (activeSpeech) { stopSpeech(); return; }
    const section = sections[state.step];
    const text = section ? [section.title, section.intro, section.questions, ...section.fields.flatMap(item => [item.label, item.prompt, item.key === 'quantitativeData' ? tableSpeech() : value(item.key)])].join('. ') : reportText();
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      activeSpeech = utterance;
      utterance.lang = 'en-US'; utterance.rate = 0.9;
      utterance.onstart = () => {
        if (activeSpeech === utterance) el('speech-status').textContent = 'Reading aloud.';
      };
      utterance.onend = () => {
        if (activeSpeech !== utterance) return;
        activeSpeech = null;
        speechIdle();
      };
      utterance.onerror = event => {
        if (activeSpeech !== utterance) return;
        activeSpeech = null;
        const canceled = ['canceled', 'interrupted'].includes(event.error);
        speechIdle(canceled ? '' : 'Reading stopped. Try Read aloud again or use your device’s reading tools.');
      };
      el('read-aloud').textContent = 'Stop reading';
      el('read-aloud').setAttribute('aria-pressed', 'true');
      el('speech-status').textContent = 'Starting read aloud…';
      window.speechSynthesis.speak(utterance);
    } catch (_) {
      activeSpeech = null;
      speechIdle('Reading could not start. Try Read aloud again or use your device’s reading tools.');
    }
  }
  function render() {
    const content = el('step-content');
    content.replaceChildren();
    updateProgress();
    const section = sections[state.step];
    el('step-number').textContent = `Step ${state.step + 1} of 8`;
    el('step-title').textContent = section?.title || 'Review & Export';
    el('step-intro').textContent = section?.intro || 'Review your organized work, then download it as a PDF to help you write your lab report.';
    el('review-tools').hidden = !!section;
    if (section) {
      const guide = node('div', undefined, 'bridge-callout support');
      guide.append(node('h3', 'Think about'), node('p', section.questions));
      content.append(guide);
      const words = glossary(section.fields);
      if (words) content.append(words);
      if (state.step === 0) {
        const details = node('div', undefined, 'goal-card');
        details.setAttribute('role', 'group');
        details.setAttribute('aria-labelledby', 'report-details-title');
        const heading = node('h3', 'Report details');
        heading.id = 'report-details-title';
        details.append(heading);
        metadata.forEach(item => details.append(makeField(item, true)));
        content.append(details);
      }
      const fields = node('div', undefined, 'goal-card');
      section.fields.forEach((item, index) => {
        if (item.key === 'hypothesisOutcomeExplanation') return;
        const fieldNode = item.key === 'quantitativeData'
          ? quantitativeField(item)
          : makeField(item, false, state.step === 0 && index === 1);
        if (item.key === 'hypothesisOutcome') {
          const explanation = section.fields.find(field => field.key === 'hypothesisOutcomeExplanation');
          const explanationNode = makeField(explanation);
          explanationNode.classList.add('outcome-explanation');
          fieldNode.append(explanationNode);
        }
        fields.append(fieldNode);
      });
      content.append(fields);
      content.append(checklist(section));
    } else {
      content.append(...reviewOverview(), reportArticle());
    }
    el('previous').disabled = state.step === 0;
    el('next').hidden = state.step === sections.length;
    el('next').textContent = state.step === 6 ? 'Review & Export →' : 'Next →';
    updateProgress();
  }
  function revealActivePill() {
    const links = el('step-links');
    const pill = links.children[state.step];
    const container = links.getBoundingClientRect();
    const selected = pill.getBoundingClientRect();
    if (selected.left < container.left + 4) links.scrollLeft += selected.left - container.left - 4;
    else if (selected.right > container.right - 4) links.scrollLeft += selected.right - container.right + 4;
  }
  function goTo(index) {
    stopSpeech();
    state.step = Math.max(0, Math.min(sections.length, index));
    state.activeSection = sections[state.step]?.id || 'review';
    save(); render();
    updateStickyOffsets();
    el('step-title').focus();
    el('step-title').scrollIntoView({ block: 'start' });
  }
  [...sections, { short: 'Review & Export' }].forEach((_, index) => el('step-links').append(button('', () => goTo(index))));
  for (const key of ['focus', 'large', 'contrast', 'starters']) el(`toggle-${key}`).addEventListener('click', () => {
    state.settings[key] = !state.settings[key]; applySettings(); revealActivePill(); save();
  });
  el('previous').addEventListener('click', () => goTo(state.step - 1));
  el('next').addEventListener('click', () => goTo(state.step + 1));
  el('print-button').addEventListener('click', () => { refreshPrint(); window.print(); });
  window.addEventListener('beforeprint', refreshPrint);
  window.addEventListener('pagehide', stopSpeech);
  el('read-aloud').disabled = !speechAvailable;
  speechIdle(speechAvailable ? '' : 'Read aloud is unavailable in this browser.');
  el('read-aloud').addEventListener('click', readAloud);
  el('reset-report').addEventListener('click', () => {
    if (!window.confirm('Start over? This permanently clears the active report and checklists in this browser. Download your work first if you want to keep it.')) return;
    try { localStorage.removeItem(STORAGE_KEY); }
    catch (_) { el('save-status').textContent = 'The saved report could not be cleared. Your current work has been kept.'; return; }
    stopSpeech(); state = blank(); saveBlocked = false;
    applySettings(); render(); revealActivePill(); refreshPrint();
    save();
    el('step-title').focus();
  });
  // Prevent a second tab from silently overwriting this tab's work.
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    saveBlocked = true;
    el('save-status').textContent = 'The saved report changed in another tab. Saving here is paused. Download this tab’s work, then reload to use the saved report.';
  });
  try { if (sessionStorage.getItem('lyfelabz-ls') === 'on') document.body.classList.add('ls-active'); } catch (_) { /* Optional educator context. */ }
  function updateStickyOffsets() {
    const header = document.querySelector('.site-nav');
    const headerHeight = getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().height : 0;
    const navigationHeight = el('report-navigation').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--site-nav-height', `${headerHeight}px`);
    document.documentElement.style.setProperty('--report-nav-height', `${navigationHeight}px`);
    revealActivePill();
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(updateStickyOffsets);
    observer.observe(document.querySelector('.site-nav'));
    observer.observe(el('report-navigation'));
  }
  window.addEventListener('resize', updateStickyOffsets);
  try { history.scrollRestoration = 'manual'; } catch (_) { /* Browsers may restrict this setting. */ }
  updateStickyOffsets();
  el('save-status').textContent = loadMessage;
  applySettings(); render(); revealActivePill(); refreshPrint();
  if (restoredActiveSection) el('step-title').scrollIntoView({ block: 'start' });
})();
