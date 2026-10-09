/* LyfeLabz Lab Report Assistant. Saves in the browser; on hosts where cloud
 * saving is enabled, a signed-in student's report also autosaves to their
 * LyfeLabz account through assets/lab-report-cloud-sync.js. */
(() => {
  'use strict';
  const STORAGE_KEY = 'lyfelabz:lab-report-assistant:v1';
  // Cloud saving is enabled per host. The browser storage of one hostname is
  // invisible to another, so cloud saving lives on the app origin only, where
  // students already sign in. Production opened after the labReports
  // callables were deployed to lyfelabz-prod and staging was verified; set
  // this to false and release Hosting to roll back to browser-only saving
  // (docs/platform/LAB_REPORT_CLOUD_AUTOSAVE.md).
  const CLOUD_PRODUCTION_ENABLED = true;
  const CLOUD_HOSTS = {
    'app.lyfelabz.com': CLOUD_PRODUCTION_ENABLED,
    'lyfelabz-staging.web.app': true,
    'lyfelabz-staging.firebaseapp.com': true,
    'localhost': true,
    '127.0.0.1': true
  };
  // Hosts that serve this page but cannot reach the student's sign-in. They
  // point students to the app origin; reports never travel in the URL.
  const CLOUD_HOME = {
    'lyfelabz.com': 'app.lyfelabz.com',
    'www.lyfelabz.com': 'app.lyfelabz.com',
    'lyfelabz-staging-marketing.web.app': 'lyfelabz-staging.web.app'
  };
  const pageHost = window.location.hostname;
  const cloudHost = CLOUD_HOSTS[pageHost] === true && !!window.LyfeLabzLabReportSync;
  const cloudHome = CLOUD_HOSTS[CLOUD_HOME[pageHost]] === true ? CLOUD_HOME[pageHost] : null;
  const BACKUP_MARKER = 'lyfelabzLabReportBackup';
  const DEVICE_NOTICE = 'One active report is saved on this browser and device only. It does not sync or submit to your teacher. Download your work before starting over.';
  const CLOUD_NOTICE = 'Your report saves to your LyfeLabz account and is accessible on any device. It is private and is not submitted to your teacher.';
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
  // Validates a saved report (browser storage, the cloud, or a backup file)
  // and returns a complete editor state. Throws on anything unreadable; an
  // unsupported newer version is marked so it is never overwritten.
  function parseReport(parsed) {
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'number' && parsed.version > 1) {
      const error = new Error('Newer report');
      error.unsupported = true;
      throw error;
    }
    if (!parsed || parsed.version !== 1 || !parsed.responses || typeof parsed.responses !== 'object' || Array.isArray(parsed.responses) || (parsed.checkSchema !== undefined && parsed.checkSchema !== 2)) throw new Error('Invalid report');
    const previous = state;
    state = blank();
    try {
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
      }
      // 'focus' (the retired Focus Mode) is still read and written so the
      // saved report shape is unchanged; it no longer affects the page.
      for (const key of ['focus', 'large', 'contrast', 'starters']) state.settings[key] = parsed.settings?.[key] === true;
      return state;
    } finally {
      state = previous;
    }
  }
  // The unowned report saved in this browser (the original single-report
  // storage). Used directly when there is no signed-in student.
  function loadDevice() {
    saveBlocked = false;
    loadMessage = '';
    restoredActiveSection = false;
    let next = blank();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        next = parseReport(JSON.parse(saved));
        restoredActiveSection = next.step > 0;
      }
    } catch (_) {
      // Do not silently overwrite unreadable or newer-version saved work.
      next = blank();
      saveBlocked = true;
      loadMessage = 'The saved report could not be opened. Saving is paused to protect it. Download any new work before leaving. Start over can clear the saved report.';
    }
    state = next;
  }
  const withoutStep = report => {
    const { step, ...rest } = report;
    return JSON.parse(JSON.stringify(rest));
  };
  function snapshot() { return withoutStep(state); }
  function readDeviceReport() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? null : withoutStep(parseReport(JSON.parse(saved)));
    } catch (_) { return null; }
  }
  // Student work only: responses, confirmed checks, and a table with content.
  function contentKey(report) {
    const responses = {};
    Object.keys(report.responses || {}).sort().forEach(key => {
      const response = report.responses[key];
      if (typeof response === 'string' && response.trim()) responses[key] = response;
    });
    const checks = Object.keys(report.checks || {}).filter(key => report.checks[key] === true).sort();
    const table = report.quantitativeTable;
    const hasTable = !!table && (!!table.title.trim() || table.cells.some(row => row.some(cell => cell.trim())));
    return JSON.stringify({ responses, checks, table: hasTable ? table : null });
  }
  const blankContent = contentKey(blank());
  const isBlankReport = report => contentKey({ ...report, checks: {} }) === blankContent;
  let cloud = null;
  let cloudPending = cloudHost;
  let deviceEdited = false;
  function save() {
    if (cloudPending) return;
    if (cloud && cloud.edited(snapshot())) return;
    if (saveBlocked) return;
    deviceEdited = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
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
    document.documentElement.classList.toggle('large-text', !!state.settings.large);
    document.body.classList.toggle('high-contrast', !!state.settings.contrast);
    document.body.classList.toggle('hide-starters', !!state.settings.starters);
    for (const key of ['large', 'contrast', 'starters']) el(`toggle-${key}`).setAttribute('aria-pressed', String(!!state.settings[key]));
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
    article.append(node(print ? 'h1' : 'h3', 'Lab Report Assistant'));
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
    return ['Lab Report Assistant',
      ...metadata.map(item => `${item.label}: ${value(item.key).trim() || '[Not answered yet]'}`),
      ...sections.map((section, index) => `\n${index + 1}. ${section.title}\n${'-'.repeat(40)}\n` + section.fields.map(item => `${reportLabel(item)}\n${item.key === 'quantitativeData' ? tableText() : value(item.key).trim() || '[Not answered yet]'}`).join('\n\n'))
    ].join('\n');
  }
  function reviewOverview() {
    const missingGroups = sections.map((section, index) => ({ section, index, fields: missing(section) })).filter(group => group.fields.length);
    const missingCount = missingGroups.reduce((count, group) => count + group.fields.length, 0);
    const warning = node('p', missingCount
      ? `${missingCount} ${missingCount === 1 ? 'item is' : 'items are'} still missing. Fill ${missingCount === 1 ? 'it' : 'them'} in to complete your lab report. You can download it as a PDF at any time.`
      : 'All required fields contain information. Review your lab report, then download it as a PDF.', 'bridge-callout');
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
    el('step-intro').textContent = section?.intro || 'Review your lab report, then download it as a PDF.';
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
  for (const key of ['large', 'contrast', 'starters']) el(`toggle-${key}`).addEventListener('click', () => {
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
    if (cloud && cloud.mode() === 'cloud') {
      if (!cloud.isEditable()) return;
      if (!window.confirm('Start over? This permanently clears your report from your LyfeLabz account and this browser. Download your work first if you want to keep it.')) return;
      stopSpeech(); state = blank();
      applySettings(); render(); revealActivePill(); refreshPrint();
      cloud.reset(snapshot());
      el('step-title').focus();
      return;
    }
    if (cloudPending || (cloud && cloud.handles())) return;
    if (!window.confirm('Start over? This permanently clears the active report and checklists in this browser. Download your work first if you want to keep it.')) return;
    try { localStorage.removeItem(STORAGE_KEY); }
    catch (_) { el('save-status').textContent = 'The saved report could not be cleared. Your current work has been kept.'; return; }
    stopSpeech(); state = blank(); saveBlocked = false; pausedByOtherTab = false;
    unlockEditor(); showAlert('', []);
    applySettings(); render(); revealActivePill(); refreshPrint();
    save();
    el('step-title').focus();
  });

  // ---------- Editor lock ----------
  // A locked editor cannot be typed in (inert), so a student never keeps
  // writing in a tab whose work is not being saved.
  function lockEditor(reason) {
    document.body.dataset.reportLock = reason;
    el('step-content').inert = true;
    el('step-content').setAttribute('aria-disabled', 'true');
    el('reset-report').disabled = true;
    el('backup-open').disabled = true;
    if (reason === 'loading') {
      el('step-content').replaceChildren(node('p', 'Opening your report...', 'bridge-callout'));
    }
  }
  function unlockEditor() {
    const wasLoading = document.body.dataset.reportLock === 'loading';
    delete document.body.dataset.reportLock;
    el('step-content').inert = false;
    el('step-content').removeAttribute('aria-disabled');
    el('reset-report').disabled = false;
    el('backup-open').disabled = false;
    if (wasLoading) render();
  }
  function showAlert(text, actions) {
    const alert = el('report-alert');
    alert.replaceChildren();
    if (text) alert.append(node('p', text));
    if (actions.length) {
      const group = node('div', undefined, 'tool-controls');
      actions.forEach(([label, action]) => group.append(button(label, action)));
      alert.append(group);
    }
    alert.hidden = !text && !actions.length;
  }

  // ---------- Backup files ----------
  // A backup file moves a report between browsers or hostnames without any
  // cross-origin messaging and without putting student text in a URL.
  function downloadBackup(report) {
    try {
      const data = JSON.stringify({ [BACKUP_MARKER]: 1, savedAt: new Date().toISOString(), report }, null, 2);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const link = node('a');
      link.href = url;
      link.download = 'lab-report-backup.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      note('Backup file downloaded. Keep it somewhere you can find it.');
    } catch (_) {
      note('The backup file could not be downloaded. Use Download as PDF in Review & Export to keep a copy.');
    }
  }
  function parseBackupFile(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed[BACKUP_MARKER] !== 1 || !parsed.report) throw new Error('Not a backup');
    return withoutStep(parseReport(parsed.report));
  }
  function adoptLocally(report) {
    stopSpeech();
    state = { ...JSON.parse(JSON.stringify(report)), step: Math.max(0, sectionIndex(report.activeSection)) };
    applySettings(); render(); revealActivePill(); refreshPrint(); updateStickyOffsets();
  }
  function importBackup(report) {
    if (cloud && cloud.mode() === 'cloud') { cloud.importReport(report); return; }
    if (cloudPending || (cloud && cloud.handles()) || saveBlocked) {
      note('Opening a backup file is paused right now. Try again in a moment.');
      return;
    }
    if (contentKey(report) === contentKey(snapshot())) { note('This backup file matches your current report.'); return; }
    if (isBlankReport(snapshot())) { adoptLocally(report); save(); note('Your backup file is open.'); return; }
    lockEditor('choosing');
    chooseVersion({ kind: 'import', versions: [
      { id: 'tab', source: 'tab', report: snapshot(), updatedAt: null },
      { id: 'file', source: 'file', report, updatedAt: null }
    ] }).then(id => {
      unlockEditor();
      if (id === 'file') { adoptLocally(report); save(); }
    });
  }
  el('backup-download').addEventListener('click', () => downloadBackup(snapshot()));
  el('backup-open').addEventListener('click', () => el('backup-file').click());
  el('backup-file').addEventListener('change', () => {
    const file = el('backup-file').files && el('backup-file').files[0];
    el('backup-file').value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { note('This file is too large to be a Lab Report Assistant backup file.'); return; }
    file.text().then(text => {
      let report;
      try { report = parseBackupFile(text); }
      catch (_) { note('This file is not a Lab Report Assistant backup file.'); return; }
      importBackup(report);
    }, () => note('The file could not be opened.'));
  });

  // ---------- Choosing between versions ----------
  const SOURCE_LABELS = {
    cloud: 'Saved in your LyfeLabz account',
    browser: 'Unsaved changes in this browser',
    device: 'Saved in this browser, not in your account',
    tab: 'Your work in this tab',
    otherTab: 'Unsaved work from your other tab',
    file: 'From the backup file'
  };
  const CHOICE_COPY = {
    restore: { title: 'Choose which version to keep', text: 'This browser has changes that were not saved to your account, and your account has a different version. Choose the one to keep working on. The version you do not choose will be replaced, so download a copy first if you need parts of it.' },
    conflict: { title: 'Your report was changed somewhere else', text: 'Your report was saved from another tab or device while you were working here. Choose the version to keep working on. The version you do not choose will be replaced, so download a copy first if you need parts of it.' },
    takeover: { title: 'Choose which version to keep', text: 'Your report has more than one version. Choose the one to keep working on in this tab. The versions you do not choose will be replaced, so download a copy first if you need parts of them.' },
    'migrate-empty': { title: 'Is this your report?', text: 'This browser has a lab report that is not saved to any account. If it is yours, add it to your account so you can open it on any device. If it is not yours, leave it in this browser.' },
    'migrate-both': { title: 'Two reports found', text: 'Your account has a lab report, and this browser also has a lab report that is not in your account. Choose which one to keep working on. The report in this browser stays saved here either way.' },
    import: { title: 'Use the backup file?', text: 'Choose which report to keep working on. The version you do not choose will be replaced, so download a copy first if you need parts of it.' }
  };
  function describeReport(report) {
    const previous = state;
    state = { ...blank(), ...JSON.parse(JSON.stringify(report)) };
    try {
      return { title: value('labTitle').trim(), filled: sections.filter(section => missing(section).length === 0).length, text: reportText() };
    } finally { state = previous; }
  }
  function savedTime(millis) {
    try { return new Date(millis).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (_) { return new Date(millis).toLocaleString(); }
  }
  let closeChoice = null;
  function chooseVersion(request) {
    if (closeChoice) closeChoice(null);
    stopSpeech();
    return new Promise(resolve => {
      const box = el('version-choice');
      const copy = CHOICE_COPY[request.kind] || CHOICE_COPY.takeover;
      const finish = id => {
        closeChoice = null;
        box.hidden = true;
        box.replaceChildren();
        resolve(id);
      };
      closeChoice = finish;
      const heading = node('h2', copy.title, 'section-title');
      heading.id = 'version-choice-title';
      heading.tabIndex = -1;
      box.replaceChildren(heading, node('p', copy.text, 'section-desc'));
      const grid = node('div', undefined, 'version-grid');
      const shown = request.kind === 'migrate-empty' ? request.versions.filter(version => version.id === 'device') : request.versions;
      shown.forEach((version, index) => {
        const info = describeReport(version.report);
        const card = node('section', undefined, 'goal-card version-card');
        const title = node('h3', SOURCE_LABELS[version.source] || 'Another version');
        title.id = `version-${index}-title`;
        card.setAttribute('aria-labelledby', title.id);
        card.append(title);
        card.append(node('p', version.updatedAt ? `Last saved ${savedTime(version.updatedAt)}` : version.source === 'cloud' ? 'Saved in your account' : 'Not saved to your account yet', 'field-help'));
        card.append(node('p', `Lab title: ${info.title || '[Not answered yet]'}`));
        card.append(node('p', `${info.filled} of 7 sections filled in`));
        const preview = node('details', undefined, 'version-preview');
        preview.append(node('summary', 'Show this version'), node('p', info.text, 'response'));
        card.append(preview);
        const actions = node('div', undefined, 'tool-controls');
        let keepLabel = 'Keep this version';
        if (request.kind === 'migrate-empty') keepLabel = 'Yes, add it to my account';
        if (request.kind === 'migrate-both') keepLabel = version.id === 'device' ? 'Use this browser’s report' : 'Keep my account report';
        actions.append(button(keepLabel, () => finish(version.id)));
        actions.append(button('Download a copy', () => downloadBackup(version.report)));
        card.append(actions);
        grid.append(card);
      });
      box.append(grid);
      if (request.kind === 'migrate-empty') {
        const decline = node('div', undefined, 'tool-controls');
        decline.append(button('No, leave it in this browser', () => finish('cloud')));
        box.append(decline);
      }
      box.hidden = false;
      heading.focus();
      heading.scrollIntoView({ block: 'start' });
    });
  }

  // ---------- Cloud saving status and account ----------
  let noteTimer = null;
  function note(text) {
    el('cloud-note').textContent = text;
    clearTimeout(noteTimer);
    if (text) noteTimer = setTimeout(() => { el('cloud-note').textContent = ''; }, 8000);
  }
  const NOTICES = {
    updated: 'Your report was updated with your latest saved work.',
    importSame: 'This backup file matches your current report.',
    takeOverFailed: 'We could not load your report. Check your internet connection, then try again.',
    signedInReload: 'You are signed in. Reload the page to open the report in your account.'
  };
  const ACTION_LABELS = { retry: 'Try again', signIn: 'Sign in again', takeOver: 'Edit in this tab instead', reload: 'Reload page' };
  function runAction(action) {
    if (!cloud) return;
    if (action === 'retry') cloud.retry();
    if (action === 'takeOver') cloud.takeOver();
    if (action === 'signIn') signIn();
    if (action === 'reload') window.location.reload();
  }
  function signIn() {
    if (!cloud) return;
    Promise.resolve(cloud.signIn()).catch(() => note('Sign-in did not finish. Try again.'));
  }
  function signOut() {
    if (!cloud) return;
    cloud.signOut(() => window.confirm('Your newest changes have not reached your account yet. If you sign out now, they stay saved in this browser for your account and will be saved the next time you sign in here. Sign out anyway?'))
      .catch(() => note('Sign-out did not finish. Try again.'));
  }
  const DEVICE_PANELS = {
    signedOut: ['Sign in to save your report to your LyfeLabz account so you can keep working on any device.', [['Sign in with Google', signIn]]],
    authExpired: ['Your sign-in expired. Sign in again to open the report in your account. This page is showing the report saved in this browser.', [['Sign in again', signIn]]],
    notStudent: ['Cloud saving is for LyfeLabz student accounts. Your report is saved in this browser only.', [['Sign out', signOut]]],
    notActive: ['Finish setting up your LyfeLabz student account in My Science, then reload this page. Until then, your report is saved in this browser only.', [['Sign out', signOut]]],
    authTimeout: ['We could not check your LyfeLabz sign-in, so your report is saved in this browser only. Reload the page to try again.', []],
    unavailable: ['Cloud saving could not start, so your report is saved in this browser only. Reload the page to try again.', []]
  };
  function showPanel(text, actions, link) {
    const panel = el('cloud-panel');
    const copy = node('p', text);
    if (link) {
      const anchor = node('a', link.text);
      anchor.href = link.href;
      copy.append(' ', anchor);
    }
    const row = node('div', undefined, 'cloud-account');
    row.append(copy);
    if (actions.length) {
      const group = node('div', undefined, 'tool-controls');
      actions.forEach(([label, action]) => group.append(button(label, action)));
      row.append(group);
    }
    panel.replaceChildren(row);
    panel.hidden = false;
  }
  function showStatus(info) {
    const status = el('cloud-status');
    status.hidden = !cloudHost;
    status.dataset.state = info.state;
    status.textContent = info.text;
    el('local-notice').textContent = info.mode === 'cloud' ? CLOUD_NOTICE : DEVICE_NOTICE;
    const message = el('cloud-message');
    const detail = info.state === 'action' ? '' : info.detail;
    if (message.textContent !== detail) message.textContent = detail;
    if (info.mode === 'cloud' || info.state === 'action') {
      showAlert(info.state === 'action' ? info.detail : '', info.actions.map(action => [ACTION_LABELS[action], () => runAction(action)]));
    }
  }
  let firstCloudRender = true;
  const cloudUi = {
    status: showStatus,
    account(info) {
      if (info.signedIn) showPanel(`Saving to the LyfeLabz account for ${info.user.label}.`, [['Sign out', signOut]]);
      else showPanel('Checking your LyfeLabz sign-in...', []);
    },
    render(report) {
      adoptLocally(report);
      if (firstCloudRender && state.step > 0) el('step-title').scrollIntoView({ block: 'start' });
      firstCloudRender = false;
    },
    lock(reason) { lockEditor(reason || 'paused'); },
    unlock() { if (document.body.dataset.reportLock) unlockEditor(); },
    choose: chooseVersion,
    notice(kind) { note(NOTICES[kind] || ''); },
    clear() {
      // Account changed or signed out: remove the previous student's report
      // from the page before anything else happens.
      if (closeChoice) closeChoice(null);
      stopSpeech();
      state = blank();
      applySettings(); render(); refreshPrint();
      lockEditor('loading');
      showAlert('', []);
      note('');
    },
    device(info) {
      cloudPending = false;
      loadDevice();
      deviceEdited = false;
      el('save-status').textContent = loadMessage;
      showAlert('', []);
      unlockEditor();
      applySettings(); render(); revealActivePill(); refreshPrint(); updateStickyOffsets();
      const [text, actions] = DEVICE_PANELS[info.reason] || DEVICE_PANELS.unavailable;
      showPanel(text, actions, info.reason === 'notActive' ? { text: 'Open My Science', href: '/app/' } : null);
      if (restoredActiveSection) el('step-title').scrollIntoView({ block: 'start' });
    }
  };
  function loadCloudTransport() {
    return new Promise(resolve => {
      const ready = () => window.lyfelabz && window.lyfelabz.labReportCloud;
      if (ready()) { resolve(ready()); return; }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ready() || null);
      };
      const timer = setTimeout(done, 15000);
      window.addEventListener('lyfelabz:lab-report-cloud-ready', done, { once: true });
      const add = (src, next) => {
        const script = node('script');
        script.src = src;
        script.onload = next;
        script.onerror = done;
        document.head.append(script);
      };
      add('assets/lyfelabz-firebase-config.js', () => add('assets/lyfelabz-lab-report-cloud.js', () => { if (ready()) done(); }));
    });
  }
  function startCloud() {
    lockEditor('loading');
    showPanel('Checking your LyfeLabz sign-in...', []);
    let storage = null;
    try { storage = window.localStorage; } catch (_) { storage = null; }
    let tabId = 't';
    for (let i = 0; i < 16; i++) tabId += Math.floor(Math.random() * 36).toString(36);
    loadCloudTransport().then(transport => {
      cloud = window.LyfeLabzLabReportSync.create({
        transport,
        storage,
        tabId,
        timers: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: id => window.clearTimeout(id), now: () => Date.now() },
        random: Math.random,
        parse: raw => withoutStep(parseReport(raw)),
        blank: () => withoutStep(blank()),
        isBlank: isBlankReport,
        contentKey,
        readDeviceReport,
        deviceEdited: () => deviceEdited,
        ui: cloudUi
      });
      cloudPending = false;
      cloud.start();
    });
  }

  // Another tab writing this browser's report: pause editing here so the
  // student never keeps typing in a tab whose work is not being saved.
  let pausedByOtherTab = false;
  function loadLatestDeviceReport() {
    pausedByOtherTab = false;
    loadDevice();
    el('save-status').textContent = loadMessage;
    showAlert('', []);
    unlockEditor();
    applySettings(); render(); revealActivePill(); refreshPrint();
    el('step-title').focus();
  }
  window.addEventListener('storage', event => {
    if (cloud && cloud.mode() === 'cloud') { cloud.onStorage(event); return; }
    if (cloudPending || (cloud && cloud.handles())) return;
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    saveBlocked = true;
    if (pausedByOtherTab) return;
    pausedByOtherTab = true;
    lockEditor('otherTab');
    el('save-status').textContent = '';
    showAlert('The saved report changed in another tab. Editing is paused here so your work is not overwritten.', [
      ['Load the latest saved report', loadLatestDeviceReport],
      ['Download this tab’s work', () => downloadBackup(snapshot())]
    ]);
  });
  window.addEventListener('beforeunload', event => {
    if (!cloud || !cloud.hasUnsavedWork()) return;
    cloud.flushNow();
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('pagehide', () => { if (cloud) cloud.flushNow(); });
  window.addEventListener('pageshow', event => { if (cloud && event.persisted) cloud.refresh(true); });
  window.addEventListener('online', () => { if (cloud) cloud.onOnline(); });
  document.addEventListener('visibilitychange', () => {
    if (!cloud) return;
    if (document.visibilityState === 'hidden') cloud.flushNow();
    else cloud.refresh(false);
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
  if (cloudHome) {
    const link = node('a', `${cloudHome}/tool_lab-report-assistant.html`);
    link.href = `https://${cloudHome}/tool_lab-report-assistant.html`;
    const notice = el('origin-notice');
    notice.replaceChildren(
      node('p', 'To save your report to your LyfeLabz account, use the Lab Report Assistant on the LyfeLabz app site. A report on this page stays in this browser only. To move it: 1. Open Backup & Recovery and choose Save backup. 2. Open the link below and sign in. 3. Open Backup & Recovery and choose Restore backup.'),
      link
    );
    notice.hidden = false;
  }
  if (cloudHost) {
    state = blank();
    applySettings(); render(); revealActivePill(); refreshPrint();
    startCloud();
  } else {
    loadDevice();
    el('save-status').textContent = loadMessage;
    applySettings(); render(); revealActivePill(); refreshPrint();
    if (restoredActiveSection) el('step-title').scrollIntoView({ block: 'start' });
  }
})();
