const refreshStatus = document.getElementById("missing-books-refresh");
const statusText = document.getElementById("missing-books-status");
const pageRefreshButton = document.getElementById("refresh-missing-books-page");

const tabsSection = document.querySelector(".tabs");
const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const schoolSearchForm = document.getElementById("missing-books-search-form");
const schoolIdInput = document.getElementById("missing-books-school-id");
const schoolStudentFilterInput = document.getElementById("missing-books-student-filter");
const schoolSubjectFilterInput = document.getElementById("missing-books-subject-filter");
const schoolFilterHelper = document.getElementById("missing-books-filter-helper");
const schoolCountText = document.getElementById("missing-books-count");
const schoolBatchCountText = document.getElementById("missing-books-batch-count");
const schoolSummaryText = document.getElementById("missing-books-school-summary");
const schoolResultsBody = document.getElementById("missing-books-body");
const downloadCsvButton = document.getElementById("download-missing-books-csv");
const downloadJsonButton = document.getElementById("download-missing-books-json");

const createMissingBatchForm = document.getElementById("create-missing-batch-form");
const missingBatchNameInput = document.getElementById("missing-batch-name");
const missingBatchSelect = document.getElementById("missing-batch-select");
const missingBatchHelper = document.getElementById("missing-batch-helper");
const missingBatchSchoolsForm = document.getElementById("missing-batch-schools-form");
const missingBatchSchoolIdsInput = document.getElementById("missing-batch-school-ids");
const missingBatchAddSchoolsButton = document.getElementById("missing-batch-add-schools");
const missingBatchSchoolHelper = document.getElementById("missing-batch-school-helper");
const missingBatchSearchForm = document.getElementById("missing-batch-search-form");
const missingBatchSchoolFilterSelect = document.getElementById("missing-batch-school-filter");
const missingBatchSchoolFilterSummary = document.getElementById("missing-batch-school-filter-summary");
const missingBatchStudentFilterInput = document.getElementById("missing-batch-student-filter");
const missingBatchClassFilterInput = document.getElementById("missing-batch-class-filter");
const missingBatchSubjectFilterInput = document.getElementById("missing-batch-subject-filter");
const missingBatchSearchButton = document.getElementById("missing-batch-search-button");
const addSelectedRowsButton = document.getElementById("add-selected-to-missing-batch");
const addLoadedRowsButton = document.getElementById("add-loaded-to-missing-batch");
const addSubjectToMissingBatchButton = document.getElementById("add-subject-to-missing-batch");
const missingBatchSearchHelper = document.getElementById("missing-batch-search-helper");
const missingBatchSelectedSummary = document.getElementById("missing-batch-selected-summary");
const missingBatchSchoolsCount = document.getElementById("missing-batch-schools-count");
const missingBatchResultsCount = document.getElementById("missing-batch-results-count");
const missingBatchSourceCount = document.getElementById("missing-batch-source-count");
const missingBatchesBody = document.getElementById("missing-batches-body");
const missingBatchesCount = document.getElementById("missing-batches-count");
const missingBatchResultsBody = document.getElementById("missing-batch-results-body");
const selectAllMissingBatchResults = document.getElementById("select-all-missing-batch-results");
const nonpMissingBatchSelect = document.getElementById("nonp-missing-batch-select");
const openAddNonpBooksModalButton = document.getElementById("open-add-nonp-books-modal");
const openAddAllNonpSubjectsModalButton = document.getElementById("open-add-all-nonp-subjects-modal");
const nonpBooksSelectedSummary = document.getElementById("nonp-books-selected-summary");
const nonpBooksHelper = document.getElementById("nonp-books-helper");

let activeSchoolId = "";
let schoolDataRows = [];
let schoolDataFilteredRows = [];
let schoolDataMeta = { school_id: "", school_name: "", batch_count: 0 };

let missingBatches = [];
let selectedMissingBatchId = 0;
let selectedMissingBatchSchools = [];
let missingBatchSearchRows = [];
let missingBatchSearchMeta = { batch_count: 0, row_count: 0 };
let selectedMissingBatchRowKeys = new Set();
let selectedNonpMissingBatchId = 0;
let modalBackdrop = null;
let statusClearTimer = null;

const updateRefreshStatus = () => {
  if (!refreshStatus) return;
  refreshStatus.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
};

const setStatus = (message, tone = "") => {
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
  if (!statusText) return;
  statusText.textContent = message || "";
  if (tone) {
    statusText.dataset.tone = tone;
  } else {
    delete statusText.dataset.tone;
  }

  if (tone === "success" && message) {
    statusClearTimer = setTimeout(() => {
      if (!statusText) return;
      statusText.textContent = "";
      delete statusText.dataset.tone;
      statusClearTimer = null;
    }, 2500);
  }
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeBatch = (batch) => ({
  id: Number(batch?.id || 0),
  batchName: String(batch?.batch_name || "").trim(),
  createdAt: batch?.created_at || "",
  status: String(batch?.status || "new").trim(),
});

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return date.toLocaleString();
};

const makeRowKey = (row) =>
  [
    row.batch_id || "",
    row.school_id || "",
    row.class_id || "",
    row.student_id || "",
    row.order_details_id || "",
    row.product_id || "",
    row.name || "",
  ].join("::");

const makeStudentContextKey = (row) =>
  [
    row.batch_id || "",
    row.school_id || "",
    row.class_id || "",
    row.product_id || "",
    row.student_id || "",
    row.order_details_id || "",
  ].join("::");

const makeBatchContextKey = (row) =>
  [row.batch_id || "", row.school_id || "", row.class_id || "", row.product_id || ""].join("::");

const switchTab = (targetId) => {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === targetId;
    button.classList.toggle("active", isActive);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== targetId);
  });
};

const setExportButtonsDisabled = (disabled) => {
  if (downloadCsvButton) downloadCsvButton.disabled = disabled;
  if (downloadJsonButton) downloadJsonButton.disabled = disabled;
};

const setSchoolFilterInputsEnabled = (enabled) => {
  if (schoolStudentFilterInput) {
    schoolStudentFilterInput.disabled = !enabled;
    if (!enabled) schoolStudentFilterInput.value = "";
  }
  if (schoolSubjectFilterInput) {
    schoolSubjectFilterInput.disabled = !enabled;
    if (!enabled) schoolSubjectFilterInput.value = "";
  }
  if (schoolFilterHelper) {
    schoolFilterHelper.textContent = enabled
      ? "Filter within the rows already loaded for this school."
      : "Load a school first to enable student and subject filters.";
  }
};

const renderSchoolDataEmptyState = (message) => {
  if (!schoolResultsBody) return;
  schoolResultsBody.innerHTML = `
    <tr>
      <td colspan="7">
        <div class="empty-state">${escapeHtml(message)}</div>
      </td>
    </tr>
  `;
};

const updateSchoolSummary = () => {
  if (schoolCountText) {
    schoolCountText.textContent = `${schoolDataFilteredRows.length} row${schoolDataFilteredRows.length === 1 ? "" : "s"}`;
  }
  if (schoolBatchCountText) {
    const batchCount = Number(schoolDataMeta.batch_count || 0);
    schoolBatchCountText.textContent = `${batchCount} source batch${batchCount === 1 ? "" : "es"}`;
  }
  if (schoolSummaryText) {
    schoolSummaryText.textContent = schoolDataMeta.school_id
      ? `School ID: ${schoolDataMeta.school_id}${schoolDataMeta.school_name ? ` | School Name: ${schoolDataMeta.school_name}` : ""}`
      : "No school selected.";
  }
};

const applySchoolDataFilters = () => {
  const studentNeedle = String(schoolStudentFilterInput?.value || "").trim().toLowerCase();
  const subjectNeedle = String(schoolSubjectFilterInput?.value || "").trim().toLowerCase();

  schoolDataFilteredRows = schoolDataRows.filter((row) => {
    const matchesStudent = !studentNeedle || String(row.student_name || "").toLowerCase().includes(studentNeedle);
    const matchesSubject = !subjectNeedle || String(row.name || "").toLowerCase().includes(subjectNeedle);
    return matchesStudent && matchesSubject;
  });
};

const renderSchoolDataRows = () => {
  if (!schoolResultsBody) return;
  if (!schoolDataFilteredRows.length) {
    renderSchoolDataEmptyState(
      activeSchoolId ? "No rows match the current filters." : "Enter a school ID to load source BookDetails rows."
    );
    updateSchoolSummary();
    return;
  }

  schoolResultsBody.innerHTML = schoolDataFilteredRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.school_id || "-")}</td>
          <td>${escapeHtml(row.school_name || "-")}</td>
          <td>${escapeHtml(row.batch_id || "-")}</td>
          <td>${escapeHtml(row.batch_name || "-")}</td>
          <td>${escapeHtml(row.student_name || "-")}</td>
          <td>${escapeHtml(row.class_name || row.class_id || "-")}</td>
          <td>${escapeHtml(row.name || "-")}</td>
        </tr>
      `
    )
    .join("");

  updateSchoolSummary();
};

const runSchoolSearch = async () => {
  const normalizedSchoolId = String(schoolIdInput?.value || "").trim();
  if (!normalizedSchoolId) {
    activeSchoolId = "";
    schoolDataRows = [];
    schoolDataFilteredRows = [];
    schoolDataMeta = { school_id: "", school_name: "", batch_count: 0 };
    setSchoolFilterInputsEnabled(false);
    setExportButtonsDisabled(true);
    renderSchoolDataEmptyState("Enter a school ID to load source BookDetails rows.");
    updateSchoolSummary();
    setStatus("School ID is required.", "error");
    return;
  }

  setStatus("Searching source BookDetails rows...", "");
  const result = await window.appBridge?.findMissingBooksBySchoolId?.({ schoolId: normalizedSchoolId });
  if (!result?.ok) {
    setStatus(result?.message || "Unable to load source rows.", "error");
    return;
  }

  activeSchoolId = String(result.data?.school_id || normalizedSchoolId).trim();
  schoolDataRows = Array.isArray(result.data?.rows) ? result.data.rows : [];
  schoolDataMeta = {
    school_id: activeSchoolId,
    school_name: String(result.data?.school_name || "").trim(),
    batch_count: Number(result.data?.batch_count || 0),
  };

  setSchoolFilterInputsEnabled(true);
  applySchoolDataFilters();
  renderSchoolDataRows();
  setExportButtonsDisabled(!schoolDataRows.length);
  updateRefreshStatus();
  setStatus(
    schoolDataRows.length
      ? `Loaded ${schoolDataRows.length} source row${schoolDataRows.length === 1 ? "" : "s"} for school ${activeSchoolId}.`
      : "No BookDetails rows found for this school ID.",
    schoolDataRows.length ? "success" : ""
  );
};

const getSelectedMissingBatch = () =>
  missingBatches.find((batch) => batch.id === Number(selectedMissingBatchId)) || null;

const getSelectedNonpMissingBatch = () =>
  missingBatches.find((batch) => batch.id === Number(selectedNonpMissingBatchId)) || null;

const renderMissingBatchResultsEmptyState = (message) => {
  if (!missingBatchResultsBody) return;
  missingBatchResultsBody.innerHTML = `
    <tr>
      <td colspan="8">
        <div class="empty-state">${escapeHtml(message)}</div>
      </td>
    </tr>
  `;
  if (selectAllMissingBatchResults) {
    selectAllMissingBatchResults.checked = false;
    selectAllMissingBatchResults.indeterminate = false;
  }
};

const updateMissingBatchSearchState = () => {
  const selectedBatch = getSelectedMissingBatch();
  const hasBatch = Boolean(selectedBatch);
  const hasSchools = selectedMissingBatchSchools.length > 0;
  const hasLoadedRows = missingBatchSearchRows.length > 0;
  const selectedVisibleCount = missingBatchSearchRows.filter((row) => selectedMissingBatchRowKeys.has(makeRowKey(row))).length;

  if (missingBatchHelper) {
    missingBatchHelper.textContent = hasBatch
      ? `${selectedBatch.batchName} selected.`
      : "Create or select a Missing batch first. Then add schools and search by student, class, or subject.";
  }
  if (missingBatchSchoolIdsInput) missingBatchSchoolIdsInput.disabled = !hasBatch;
  if (missingBatchAddSchoolsButton) missingBatchAddSchoolsButton.disabled = !hasBatch;
  if (missingBatchSchoolFilterSelect) missingBatchSchoolFilterSelect.disabled = !hasSchools;
  if (missingBatchStudentFilterInput) missingBatchStudentFilterInput.disabled = !hasSchools;
  if (missingBatchClassFilterInput) missingBatchClassFilterInput.disabled = !hasSchools;
  if (missingBatchSubjectFilterInput) missingBatchSubjectFilterInput.disabled = !hasSchools;
  if (missingBatchSearchButton) missingBatchSearchButton.disabled = !hasSchools;
  if (addSelectedRowsButton) addSelectedRowsButton.disabled = !(hasBatch && selectedVisibleCount > 0);
  if (addLoadedRowsButton) addLoadedRowsButton.disabled = !(hasBatch && hasLoadedRows);
  if (addSubjectToMissingBatchButton) addSubjectToMissingBatchButton.disabled = !(hasBatch && hasSchools);
  if (missingBatchSchoolHelper) {
    missingBatchSchoolHelper.textContent = hasBatch
      ? "Add one or more school IDs into the selected Missing batch."
      : "Select a Missing batch to start attaching schools.";
  }
  if (missingBatchSearchHelper) {
    missingBatchSearchHelper.textContent = hasSchools
      ? `${missingBatchSearchRows.length} loaded row${missingBatchSearchRows.length === 1 ? "" : "s"}, ${selectedVisibleCount} selected.`
      : "Add schools to the selected batch, then choose specific schools or search across all of them.";
  }
  if (missingBatchSelectedSummary) {
    missingBatchSelectedSummary.textContent = hasBatch
      ? [
          selectedBatch.batchName,
          selectedMissingBatchSchools.length
            ? selectedMissingBatchSchools
                .map((school) => {
                  const batchIds = Array.isArray(school.source_batch_ids) ? school.source_batch_ids.filter(Boolean) : [];
                  return `${school.school_name || school.school_id || "-"}${batchIds.length ? ` [${batchIds.join(", ")}]` : ""}`;
                })
                .join(" | ")
            : "No schools selected",
        ].join(" | ")
      : "No batch selected";
  }
  if (missingBatchSchoolsCount) {
    missingBatchSchoolsCount.textContent = `${selectedMissingBatchSchools.length} school${selectedMissingBatchSchools.length === 1 ? "" : "s"}`;
  }
  if (missingBatchResultsCount) {
    missingBatchResultsCount.textContent = `${missingBatchSearchRows.length} loaded row${missingBatchSearchRows.length === 1 ? "" : "s"}`;
  }
  if (missingBatchSourceCount) {
    const batchCount = Number(missingBatchSearchMeta.batch_count || 0);
    missingBatchSourceCount.textContent = `${batchCount} source batch${batchCount === 1 ? "" : "es"}`;
  }
};

const renderMissingBatchSchoolFilterOptions = () => {
  if (!missingBatchSchoolFilterSelect) return;
  if (!selectedMissingBatchSchools.length) {
    missingBatchSchoolFilterSelect.innerHTML = "";
    if (missingBatchSchoolFilterSummary) {
      missingBatchSchoolFilterSummary.textContent = "Selected schools will appear here with batch IDs.";
    }
    return;
  }

  missingBatchSchoolFilterSelect.innerHTML = selectedMissingBatchSchools
    .map((school) => {
      const batchIds = Array.isArray(school.source_batch_ids) ? school.source_batch_ids.filter(Boolean) : [];
      const batchLabel = batchIds.length ? ` [${batchIds.join(", ")}]` : "";
      return `<option value="${escapeHtml(school.school_id || "")}">${escapeHtml(
        school.school_name || school.school_id || "-"
      )} (${escapeHtml(school.school_id || "-")})${escapeHtml(batchLabel)}</option>`;
    })
    .join("");
  updateMissingBatchSchoolFilterSummary();
};

const clearMissingBatchSchoolFilterSelection = () => {
  if (!missingBatchSchoolFilterSelect) return;
  Array.from(missingBatchSchoolFilterSelect.options).forEach((option) => {
    option.selected = false;
  });
  updateMissingBatchSchoolFilterSummary();
};

const getSelectedMissingBatchSchoolFilterIds = () =>
  Array.from(missingBatchSchoolFilterSelect?.selectedOptions || [])
    .map((option) => String(option.value || "").trim())
    .filter(Boolean);

const updateMissingBatchSchoolFilterSummary = () => {
  if (!missingBatchSchoolFilterSummary) return;

  if (!selectedMissingBatchSchools.length) {
    missingBatchSchoolFilterSummary.textContent = "Selected schools will appear here with batch IDs.";
    return;
  }

  const selectedIds = new Set(getSelectedMissingBatchSchoolFilterIds());
  const schoolsToShow = selectedIds.size
    ? selectedMissingBatchSchools.filter((school) => selectedIds.has(String(school.school_id || "").trim()))
    : selectedMissingBatchSchools;

  missingBatchSchoolFilterSummary.textContent = schoolsToShow
    .map((school) => {
      const batchIds = Array.isArray(school.source_batch_ids) ? school.source_batch_ids.filter(Boolean) : [];
      return `${school.school_name || school.school_id || "-"} (${school.school_id || "-"})${
        batchIds.length ? ` [${batchIds.join(", ")}]` : ""
      }`;
    })
    .join(" | ");
};

const syncMissingBatchSelectAllState = () => {
  if (!selectAllMissingBatchResults) return;
  if (!missingBatchSearchRows.length) {
    selectAllMissingBatchResults.checked = false;
    selectAllMissingBatchResults.indeterminate = false;
    return;
  }

  const visibleKeys = missingBatchSearchRows.map((row) => makeRowKey(row));
  const selectedVisibleCount = visibleKeys.filter((key) => selectedMissingBatchRowKeys.has(key)).length;
  selectAllMissingBatchResults.checked = selectedVisibleCount === visibleKeys.length;
  selectAllMissingBatchResults.indeterminate =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleKeys.length;
};

const renderMissingBatchSearchRows = () => {
  if (!missingBatchResultsBody) return;
  if (!missingBatchSearchRows.length) {
    renderMissingBatchResultsEmptyState(
      selectedMissingBatchSchools.length
        ? "No rows match the current student, class, and subject search."
        : "Select a Missing batch, add schools, then search by student, class, or subject."
    );
    updateMissingBatchSearchState();
    return;
  }

  missingBatchResultsBody.innerHTML = missingBatchSearchRows
    .map(
      (row, index) => `
        <tr>
          <td>
            <input
              type="checkbox"
              class="missing-batch-row-checkbox"
              data-row-index="${index}"
              ${selectedMissingBatchRowKeys.has(makeRowKey(row)) ? "checked" : ""}
            />
          </td>
          <td>${escapeHtml(row.school_id || "-")}</td>
          <td>${escapeHtml(row.school_name || "-")}</td>
          <td>${escapeHtml(row.batch_id || "-")}</td>
          <td>${escapeHtml(row.batch_name || "-")}</td>
          <td>${escapeHtml(row.student_name || "-")}</td>
          <td>${escapeHtml(row.class_name || row.class_id || "-")}</td>
          <td>${escapeHtml(row.name || "-")}</td>
        </tr>
      `
    )
    .join("");

  missingBatchResultsBody.querySelectorAll(".missing-batch-row-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const rowIndex = Number(event.target.dataset.rowIndex);
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= missingBatchSearchRows.length) {
        setStatus("Unable to resolve selected row.", "error");
        return;
      }
      const row = missingBatchSearchRows[rowIndex];
      const rowKey = makeRowKey(row);
      if (event.target.checked) {
        selectedMissingBatchRowKeys.add(rowKey);
      } else {
        selectedMissingBatchRowKeys.delete(rowKey);
      }
      syncMissingBatchSelectAllState();
      updateMissingBatchSearchState();
    });
  });

  syncMissingBatchSelectAllState();
  updateMissingBatchSearchState();
};

const ensureModal = () => {
  if (modalBackdrop) return;
  modalBackdrop = document.createElement("div");
  modalBackdrop.className = "modal-backdrop hidden";
  modalBackdrop.innerHTML = `
    <div class="modal" style="max-width: 1000px; width: min(1000px, 95vw);">
      <div class="modal-header">
        <h3 id="missing-books-modal-title">Info</h3>
        <button class="ghost-button" id="missing-books-modal-close" type="button">Close</button>
      </div>
      <div class="modal-body" id="missing-books-modal-body"></div>
    </div>
  `;
  document.body.appendChild(modalBackdrop);
  modalBackdrop.querySelector("#missing-books-modal-close")?.addEventListener("click", () => {
    modalBackdrop.classList.add("hidden");
  });
  modalBackdrop.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) {
      modalBackdrop.classList.add("hidden");
    }
  });
};

const showModal = ({ title, html }) => {
  ensureModal();
  modalBackdrop.querySelector("#missing-books-modal-title").textContent = title || "Info";
  modalBackdrop.querySelector("#missing-books-modal-body").innerHTML = html || "";
  modalBackdrop.classList.remove("hidden");
};

const getSelectedMissingBatchRows = () =>
  missingBatchSearchRows.filter((row) => selectedMissingBatchRowKeys.has(makeRowKey(row)));

const collectStudentRows = (rows) => {
  const unique = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = makeStudentContextKey(row);
    if (!key || unique.has(key)) return;
    unique.set(key, row);
  });
  return Array.from(unique.values());
};

const openAddSubjectModal = async () => {
  if (!selectedMissingBatchId) {
    setStatus("Select a Missing batch first.", "error");
    return;
  }
  const className = String(missingBatchClassFilterInput?.value || "").trim();
  if (!className) {
    setStatus("Enter the class name first so the subject can be added for that class.", "error");
    return;
  }

  setStatus("Loading class student rows for subject add...", "");
  const baseResult = await window.appBridge?.searchMissingBatchSourceRows?.({
    targetBatchId: selectedMissingBatchId,
    schoolIds: getSelectedMissingBatchSchoolFilterIds(),
    studentName: "",
    className,
    subjectName: "",
  });
  if (!baseResult?.ok) {
    setStatus(baseResult?.message || "Unable to load class rows for subject add.", "error");
    return;
  }

  const baseRows = Array.isArray(baseResult.data?.rows) ? baseResult.data.rows : [];

  const studentRows = Array.from(
    collectStudentRows(baseRows).reduce((map, row) => {
      const key = [
        row.school_id || "",
        row.class_id || "",
        row.product_id || "",
        row.student_id || "",
        row.order_details_id || "",
      ].join("::");
      if (!map.has(key)) {
        map.set(key, row);
      }
      return map;
    }, new Map()).values()
  );
  if (!studentRows.length) {
    setStatus("No student rows found for the selected class/search.", "error");
    return;
  }

  const schoolIds = new Set(studentRows.map((row) => String(row.school_id || "").trim()).filter(Boolean));

  showModal({
    title: `Add Subject - ${escapeHtml(className)}`,
    html: `
      <div class="form-row" style="align-items: flex-start; flex-direction: column; gap: 12px;">
        <p class="helper-text">
          Class: ${escapeHtml(className)} | Students: ${escapeHtml(studentRows.length)} |
          Schools: ${escapeHtml(schoolIds.size)}
        </p>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Subject Name</span>
          <input class="text-input" id="missing-books-custom-subject-name" type="text" autocomplete="off" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Cover Code</span>
          <input class="text-input" id="missing-books-custom-covercode" type="text" autocomplete="off" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Inner Code</span>
          <input class="text-input" id="missing-books-custom-innercode" type="text" autocomplete="off" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Color 1</span>
          <input class="text-input" id="missing-books-custom-colour1" type="text" autocomplete="off" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Color 2</span>
          <input class="text-input" id="missing-books-custom-colour2" type="text" autocomplete="off" />
        </label>
        <button class="primary-button" id="missing-books-confirm-add-subject" type="button">Submit</button>
      </div>
    `,
  });

  modalBackdrop?.querySelector("#missing-books-confirm-add-subject")?.addEventListener("click", async () => {
    const subjectName = String(
      modalBackdrop?.querySelector("#missing-books-custom-subject-name")?.value || ""
    ).trim();
    const covercode = String(
      modalBackdrop?.querySelector("#missing-books-custom-covercode")?.value || ""
    ).trim();
    const innercode = String(
      modalBackdrop?.querySelector("#missing-books-custom-innercode")?.value || ""
    ).trim();
    const colour1 = String(
      modalBackdrop?.querySelector("#missing-books-custom-colour1")?.value || ""
    ).trim();
    const colour2 = String(
      modalBackdrop?.querySelector("#missing-books-custom-colour2")?.value || ""
    ).trim();

    if (!(subjectName && covercode && innercode)) {
      setStatus("Enter subject name, cover code, and inner code.", "error");
      return;
    }

    const items = studentRows.map((row) => ({
        batch_id: row.batch_id,
        school_id: row.school_id,
        class_id: row.class_id,
        student_id: row.student_id,
        order_details_id: row.order_details_id,
        product_id: row.product_id,
        name: subjectName,
        covercode,
        innercode,
        colour_1: colour1,
        colour_2: colour2,
      }));

    modalBackdrop?.classList.add("hidden");
    const added = await addRowsToSelectedMissingBatch(items, `${subjectName} for class ${className}`);
    if (!added) {
      return;
    }

    setStatus(
      `Added subject ${subjectName} for ${studentRows.length} student${studentRows.length === 1 ? "" : "s"} in ${className}.`,
      "success"
    );
  });
};

const renderVerifyStudentsModal = (batch, rows) => {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    showModal({
      title: `Verify Students - ${batch.batchName}`,
      html: `<p class="helper-text">No sample cover rows found for this batch.</p>`,
    });
    return;
  }

  const body = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>School</th>
            <th>Student</th>
            <th>Class</th>
            <th>Subject</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.school_name || row.school_id || "-")}</td>
                  <td>${escapeHtml(row.student_name || "-")}</td>
                  <td>${escapeHtml(row.class_name || row.class_id || "-")}</td>
                  <td>${escapeHtml(row.name || row.subject_name || "-")}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  showModal({ title: `Verify Students - ${batch.batchName}`, html: body });
};

const renderDetailedInfoModal = (batch, payload) => {
  const missingDetailsBySchool = Array.isArray(payload?.missing_details_by_school) ? payload.missing_details_by_school : [];
  if (missingDetailsBySchool.length) {
    const body = `
      <p class="helper-text" style="margin-bottom: 12px;">
        Schools: ${escapeHtml(payload?.totals?.school_count || 0)} |
        Missing rows: ${escapeHtml(payload?.totals?.row_count || 0)}
      </p>
      ${missingDetailsBySchool
        .map(
          (school) => `
            <div style="margin-bottom: 16px;">
              <p class="helper-text" style="margin-bottom: 8px;"><strong>${escapeHtml(
                school.school_name || school.school_id || "-"
              )}</strong></p>
              <div class="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Student Name</th>
                      <th>Class</th>
                      <th>Subject</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(Array.isArray(school.missing_details) ? school.missing_details : [])
                      .map(
                        (row) => `
                          <tr>
                            <td>${escapeHtml(row.student_name || "-")}</td>
                            <td>${escapeHtml(row.class_name || "-")}</td>
                            <td>${escapeHtml(row.subject_name || "-")}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>
          `
        )
        .join("")}
    `;
    showModal({ title: `Book Info - ${batch.batchName}`, html: body });
    return;
  }

  const schools = Array.isArray(payload?.schools) ? payload.schools : [];
  const totals = payload?.totals || {};
  const body = `
    <p class="helper-text" style="margin-bottom: 12px;">
      Schools: ${escapeHtml(totals.school_count || 0)} |
      Product details: ${escapeHtml(totals.product_detail_count || 0)} |
      Personalized students: ${escapeHtml(totals.personalized_student_count || 0)} |
      Nonp quantity: ${escapeHtml(totals.nonp_quantity_count || 0)}
    </p>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>School ID</th>
            <th>School Name</th>
            <th>Product Detail Classes</th>
            <th>Student Classes</th>
            <th>Nonp Classes</th>
          </tr>
        </thead>
        <tbody>
          ${schools
            .map(
              (school) => `
                <tr>
                  <td>${escapeHtml(school.school_id || "-")}</td>
                  <td>${escapeHtml(school.school_name || "-")}</td>
                  <td>${escapeHtml(Array.isArray(school.product_details_by_class) ? school.product_details_by_class.length : 0)}</td>
                  <td>${escapeHtml(Array.isArray(school.personalized_students_by_class) ? school.personalized_students_by_class.length : 0)}</td>
                  <td>${escapeHtml(Array.isArray(school.nonp_quantity_by_class) ? school.nonp_quantity_by_class.length : 0)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  showModal({ title: `Detailed Info - ${batch.batchName}`, html: body });
};

const renderMissingBatchSchoolsModal = (batch, schools) => {
  const items = Array.isArray(schools) ? schools : [];
  if (!items.length) {
    showModal({
      title: `Schools - ${batch.batchName}`,
      html: `<p class="helper-text">No schools have been added to this Missing batch yet.</p>`,
    });
    return;
  }

  const body = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>School ID</th>
            <th>School Name</th>
            <th>Source Batch IDs</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (school) => `
                <tr>
                  <td>${escapeHtml(school.school_id || "-")}</td>
                  <td>${escapeHtml(school.school_name || school.school_id || "-")}</td>
                  <td>${escapeHtml(
                    Array.isArray(school.source_batch_ids) && school.source_batch_ids.length
                      ? school.source_batch_ids.join(", ")
                      : "-"
                  )}</td>
                  <td>${escapeHtml(formatDate(school.added_at))}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  showModal({ title: `Schools - ${batch.batchName}`, html: body });
};

const addRowsToSelectedMissingBatch = async (items, scopeLabel) => {
  if (!selectedMissingBatchId) {
    setStatus("Select a Missing batch first.", "error");
    return false;
  }

  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    setStatus("No rows available to add.", "error");
    return false;
  }

  setStatus(`Adding ${scopeLabel} to Missing batch...`, "");
  const result = await window.appBridge?.addBookDetailsRowsToMissingBatch?.({
    targetBatchId: selectedMissingBatchId,
    items: rows,
  });
  if (!result?.ok) {
    setStatus(result?.message || "Unable to add rows to Missing batch.", "error");
    return false;
  }

  setStatus(
    `Added ${result.data?.added_book_details || result.data?.selected_rows || 0} BookDetails row(s) to ${
      result.data?.target_batch_name || "Missing batch"
    }.`,
    "success"
  );
  await refreshMissingBatches();
  return true;
};

const updateNonpBooksState = () => {
  const selectedBatch = getSelectedNonpMissingBatch();
  const hasBatch = Boolean(selectedBatch);

  if (openAddNonpBooksModalButton) {
    openAddNonpBooksModalButton.disabled = !hasBatch;
  }
  if (openAddAllNonpSubjectsModalButton) {
    openAddAllNonpSubjectsModalButton.disabled = !hasBatch;
  }
  if (nonpBooksSelectedSummary) {
    nonpBooksSelectedSummary.textContent = hasBatch ? `${selectedBatch.batchName} (${selectedBatch.status})` : "No batch selected";
  }
  if (nonpBooksHelper) {
    nonpBooksHelper.textContent = hasBatch
      ? `Add nonp books directly into ${selectedBatch.batchName}.`
      : "Select a Missing batch, then add nonp books by subject name, cover code, inner code, and count.";
  }
};

const getSchoolSummaryText = (schools) => {
  if (!schools.length) {
    return "No school linked";
  }

  if (schools.length === 1) {
    const school = schools[0];
    return `${school.school_name || school.school_id || "-"} (${school.school_id || "-"})`;
  }

  return schools
    .map((school) => `${school.school_name || school.school_id || "-"} (${school.school_id || "-"})`)
    .join(" | ");
};

const getSelectedNonpBatchSchoolSummary = async () => {
  if (!selectedNonpMissingBatchId) {
    return "No school linked";
  }

  if (selectedMissingBatchId === selectedNonpMissingBatchId && selectedMissingBatchSchools.length) {
    return getSchoolSummaryText(selectedMissingBatchSchools);
  }

  const result = await window.appBridge?.listMissingBatchSchools?.({ targetBatchId: selectedNonpMissingBatchId });
  if (!result?.ok) {
    return "No school linked";
  }

  const schools = Array.isArray(result.data?.schools) ? result.data.schools : [];
  return getSchoolSummaryText(schools);
};

const openAddNonpBooksModal = async () => {
  const selectedBatch = getSelectedNonpMissingBatch();
  if (!selectedBatch) {
    setStatus("Select a Missing batch first.", "error");
    return;
  }
  const schoolSummary = await getSelectedNonpBatchSchoolSummary();

  showModal({
    title: `Add Nonp Books - ${escapeHtml(selectedBatch.batchName)}`,
    html: `
      <div class="form-row" style="align-items: flex-start; flex-direction: column; gap: 12px;">
        <p class="helper-text">
          Adding for school: ${escapeHtml(schoolSummary)}
        </p>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Subject Name</span>
          <input class="text-input" id="missing-books-nonp-subject-name" type="text" autocomplete="off" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Cover Code</span>
          <input class="text-input" id="missing-books-nonp-covercode" type="text" autocomplete="off" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Inner Code</span>
          <input class="text-input" id="missing-books-nonp-innercode" type="text" autocomplete="off" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Count</span>
          <input class="text-input" id="missing-books-nonp-count" type="number" min="1" step="1" value="1" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Color 1</span>
          <input class="text-input" id="missing-books-nonp-colour1" type="text" autocomplete="off" value="1" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Color 2</span>
          <input class="text-input" id="missing-books-nonp-colour2" type="text" autocomplete="off" value="2" />
        </label>
        <button class="primary-button" id="missing-books-confirm-add-nonp" type="button">Add Books</button>
      </div>
    `,
  });

  modalBackdrop?.querySelector("#missing-books-confirm-add-nonp")?.addEventListener("click", async () => {
    const subjectName = String(
      modalBackdrop?.querySelector("#missing-books-nonp-subject-name")?.value || ""
    ).trim();
    const covercode = String(
      modalBackdrop?.querySelector("#missing-books-nonp-covercode")?.value || ""
    ).trim();
    const innercode = String(
      modalBackdrop?.querySelector("#missing-books-nonp-innercode")?.value || ""
    ).trim();
    const count = Number(modalBackdrop?.querySelector("#missing-books-nonp-count")?.value || 0);
    const colour1 = String(
      modalBackdrop?.querySelector("#missing-books-nonp-colour1")?.value || "1"
    ).trim();
    const colour2 = String(
      modalBackdrop?.querySelector("#missing-books-nonp-colour2")?.value || "2"
    ).trim();

    if (!(subjectName && covercode && innercode)) {
      setStatus("Enter subject name, cover code, and inner code.", "error");
      return;
    }
    if (!Number.isInteger(count) || count <= 0) {
      setStatus("Enter a valid count greater than 0.", "error");
      return;
    }

    modalBackdrop?.classList.add("hidden");
    setStatus(`Adding ${count} nonp book(s) to Missing batch...`, "");
    const result = await window.appBridge?.addNonpBooksToMissingBatch?.({
      targetBatchId: selectedNonpMissingBatchId,
      subjectName,
      covercode,
      innercode,
      count,
      colour1: colour1 || "1",
      colour2: colour2 || "2",
    });
    if (!result?.ok) {
      setStatus(result?.message || "Unable to add nonp books to Missing batch.", "error");
      return;
    }

    setStatus(
      `Added ${result.data?.added_book_details || 0} nonp book row(s) to ${result.data?.target_batch_name || "Missing batch"}.`,
      "success"
    );
    await refreshMissingBatches();
  });
};

const openAddAllNonpSubjectsModal = async () => {
  const selectedBatch = getSelectedNonpMissingBatch();
  if (!selectedBatch) {
    setStatus("Select a Missing batch first.", "error");
    return;
  }
  const schoolSummary = await getSelectedNonpBatchSchoolSummary();

  showModal({
    title: `Add All Subjects - ${escapeHtml(selectedBatch.batchName)}`,
    html: `
      <div class="form-row" style="align-items: flex-start; flex-direction: column; gap: 12px;">
        <p class="helper-text">
          Adding for school: ${escapeHtml(schoolSummary)}
        </p>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Class</span>
          <select class="text-input" id="missing-books-all-nonp-class-code">
            <option value="01">Playgroup</option>
            <option value="02">Nursery</option>
            <option value="03">LKG</option>
            <option value="04">UKG</option>
          </select>
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Count Per Subject</span>
          <input class="text-input" id="missing-books-all-nonp-count" type="number" min="1" step="1" value="1" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Color 1</span>
          <input class="text-input" id="missing-books-all-nonp-colour1" type="text" autocomplete="off" value="1" />
        </label>
        <label class="form-row" style="width: 100%; align-items: flex-start; flex-direction: column; gap: 6px;">
          <span>Color 2</span>
          <input class="text-input" id="missing-books-all-nonp-colour2" type="text" autocomplete="off" value="2" />
        </label>
        <button class="primary-button" id="missing-books-preview-all-nonp" type="button">Show Subjects</button>
      </div>
    `,
  });

  modalBackdrop?.querySelector("#missing-books-preview-all-nonp")?.addEventListener("click", async () => {
    const classCode = String(
      modalBackdrop?.querySelector("#missing-books-all-nonp-class-code")?.value || ""
    ).trim();
    const count = Number(modalBackdrop?.querySelector("#missing-books-all-nonp-count")?.value || 0);
    const colour1 = String(
      modalBackdrop?.querySelector("#missing-books-all-nonp-colour1")?.value || "1"
    ).trim();
    const colour2 = String(
      modalBackdrop?.querySelector("#missing-books-all-nonp-colour2")?.value || "2"
    ).trim();

    if (!classCode) {
      setStatus("Select a class first.", "error");
      return;
    }
    if (!Number.isInteger(count) || count <= 0) {
      setStatus("Enter a valid count greater than 0.", "error");
      return;
    }

    setStatus("Loading subjects for selected class...", "");
    const previewResult = await window.appBridge?.previewNonpSubjectsForMissingBatch?.({
      targetBatchId: selectedNonpMissingBatchId,
      classCode,
    });
    if (!previewResult?.ok) {
      setStatus(previewResult?.message || "Unable to load subjects.", "error");
      return;
    }

    const subjects = Array.isArray(previewResult.data?.subjects) ? previewResult.data.subjects : [];
    if (!subjects.length) {
      setStatus("No subjects found for the selected class in this batch.", "error");
      return;
    }

    showModal({
      title: `Subjects - ${escapeHtml(previewResult.data?.class_label || classCode)}`,
      html: `
        <p class="helper-text" style="margin-bottom: 12px;">
          ${escapeHtml(subjects.length)} subject(s) found. Count per subject: ${escapeHtml(count)}.
        </p>
        <p class="helper-text" style="margin-bottom: 12px;">
          Adding for school: ${escapeHtml(schoolSummary)}
        </p>
        <div class="table-wrapper" style="margin-bottom: 12px;">
          <table>
            <thead>
              <tr>
                <th>Subject Name</th>
                <th>Cover Code</th>
                <th>Inner Code</th>
              </tr>
            </thead>
            <tbody>
              ${subjects
                .map(
                  (item) => `
                    <tr>
                      <td>${escapeHtml(item.name || "-")}</td>
                      <td>${escapeHtml(item.covercode || "-")}</td>
                      <td>${escapeHtml(item.innercode || "-")}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <button class="primary-button" id="missing-books-confirm-add-all-nonp" type="button">Add All Subjects</button>
      `,
    });

    modalBackdrop?.querySelector("#missing-books-confirm-add-all-nonp")?.addEventListener("click", async () => {
      modalBackdrop?.classList.add("hidden");
      setStatus(`Adding ${subjects.length} subject(s) with count ${count}...`, "");
      const result = await window.appBridge?.addAllNonpSubjectsToMissingBatch?.({
        targetBatchId: selectedNonpMissingBatchId,
        classCode,
        count,
        colour1: colour1 || "1",
        colour2: colour2 || "2",
      });
      if (!result?.ok) {
        setStatus(result?.message || "Unable to add all nonp subjects.", "error");
        return;
      }

      setStatus(
        `Added ${result.data?.added_book_details || 0} nonp book row(s) from ${result.data?.subject_count || 0} subject(s) to ${result.data?.target_batch_name || "Missing batch"}.`,
        "success"
      );
      await refreshMissingBatches();
    });
  });
};

const handleMissingBatchAction = async (batchId, action) => {
  const batch = missingBatches.find((item) => item.id === Number(batchId));
  if (!batch) return;

  if (action === "verify") {
    setStatus("Loading verify student rows...", "");
    const result = await window.appBridge?.listBatchVerifyStudents?.({ batchId: batch.id });
    if (!result?.ok) {
      setStatus(result?.message || "Unable to load verify students.", "error");
      return;
    }
    renderVerifyStudentsModal(batch, result.data?.students || []);
    setStatus("Verify student rows loaded.", "success");
    return;
  }

  if (action === "schools") {
    setStatus("Loading batch schools...", "");
    const result = await window.appBridge?.listMissingBatchSchools?.({ targetBatchId: batch.id });
    if (!result?.ok) {
      setStatus(result?.message || "Unable to load batch schools.", "error");
      return;
    }
    renderMissingBatchSchoolsModal(batch, result.data?.schools || []);
    setStatus("Batch schools loaded.", "success");
    return;
  }

  if (action === "generate") {
    setStatus("Generating books...", "");
    const result = await window.appBridge?.generateBooks?.({ batchId: batch.id });
    if (!result?.ok) {
      setStatus(result?.message || "Unable to generate books.", "error");
      return;
    }
    setStatus(result?.data?.message || `Generated books for ${batch.batchName}.`, "success");
    await refreshMissingBatches();
    return;
  }

  if (action === "regenerate") {
    const confirmed = window.confirm(
      `Reset generated cover/inner flags and regenerate books for ${batch.batchName}?`
    );
    if (!confirmed) {
      setStatus("Regenerate cancelled.", "");
      return;
    }

    setStatus("Regenerating books...", "");
    const result = await window.appBridge?.regenerateBooks?.({ batchId: batch.id });
    if (!result?.ok) {
      setStatus(result?.message || "Unable to regenerate books.", "error");
      return;
    }
    setStatus(result?.data?.message || `Regenerated books for ${batch.batchName}.`, "success");
    await refreshMissingBatches();
    return;
  }

  if (action === "details") {
    setStatus("Loading book info...", "");
    const result = await window.appBridge?.listBatchDetailedInfo?.({ batchId: batch.id });
    if (!result?.ok) {
      setStatus(result?.message || "Unable to load detailed info.", "error");
      return;
    }
    renderDetailedInfoModal(batch, result.data || {});
    setStatus("Book info loaded.", "success");
  }
};

const renderMissingBatches = () => {
  if (missingBatchesCount) {
    missingBatchesCount.textContent = String(missingBatches.length);
  }

  if (missingBatchSelect) {
    const currentValue = String(selectedMissingBatchId || "");
    missingBatchSelect.innerHTML = [
      `<option value="">Select Missing Batch</option>`,
      ...missingBatches.map(
        (batch) =>
          `<option value="${batch.id}" ${currentValue === String(batch.id) ? "selected" : ""}>${escapeHtml(batch.batchName)} (${escapeHtml(batch.status)})</option>`
      ),
    ].join("");
  }

  if (nonpMissingBatchSelect) {
    const currentValue = String(selectedNonpMissingBatchId || "");
    nonpMissingBatchSelect.innerHTML = [
      `<option value="">Select Missing Batch</option>`,
      ...missingBatches.map(
        (batch) =>
          `<option value="${batch.id}" ${currentValue === String(batch.id) ? "selected" : ""}>${escapeHtml(batch.batchName)} (${escapeHtml(batch.status)})</option>`
      ),
    ].join("");
  }

  if (!missingBatches.length) {
    if (missingBatchesBody) {
      missingBatchesBody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">No Missing batches created yet.</div>
          </td>
        </tr>
      `;
    }
    selectedNonpMissingBatchId = 0;
    updateMissingBatchSearchState();
    updateNonpBooksState();
    return;
  }

  if (!missingBatches.find((batch) => batch.id === Number(selectedMissingBatchId))) {
    selectedMissingBatchId = 0;
  }
  if (!missingBatches.find((batch) => batch.id === Number(selectedNonpMissingBatchId))) {
    selectedNonpMissingBatchId = 0;
  }

  if (missingBatchesBody) {
    missingBatchesBody.innerHTML = missingBatches
      .map(
        (batch) => `
          <tr>
            <td>${escapeHtml(batch.id)}</td>
            <td>${escapeHtml(batch.batchName)}</td>
            <td>${escapeHtml(formatDate(batch.createdAt))}</td>
            <td><span class="status-chip chip-${escapeHtml(batch.status)}">${escapeHtml(batch.status)}</span></td>
            <td>
              <div class="action-group">
                <button class="ghost-button missing-batch-action" data-action="schools" data-batch-id="${batch.id}" type="button">View Schools</button>
                <button class="ghost-button missing-batch-action" data-action="verify" data-batch-id="${batch.id}" type="button">Verify Students</button>
                <button class="ghost-button missing-batch-action" data-action="generate" data-batch-id="${batch.id}" type="button">Generate Books</button>
                <button class="ghost-button missing-batch-action" data-action="regenerate" data-batch-id="${batch.id}" type="button">Regenerate Books</button>
                <button class="ghost-button missing-batch-action" data-action="details" data-batch-id="${batch.id}" type="button">Book Info</button>
              </div>
            </td>
          </tr>
        `
      )
      .join("");
  }

  updateMissingBatchSearchState();
  updateNonpBooksState();
};

const refreshMissingBatches = async () => {
  const result = await window.appBridge?.listMissingBatches?.();
  if (!result?.ok) {
    setStatus(result?.message || "Unable to load Missing batches.", "error");
    return;
  }
  missingBatches = (Array.isArray(result.data) ? result.data : []).map(normalizeBatch);
  renderMissingBatches();
};

const clearMissingBatchSearchResults = (message) => {
  missingBatchSearchRows = [];
  missingBatchSearchMeta = { batch_count: 0, row_count: 0 };
  selectedMissingBatchRowKeys.clear();
  renderMissingBatchResultsEmptyState(message);
  updateMissingBatchSearchState();
};

const refreshSelectedMissingBatchSchools = async () => {
  if (!selectedMissingBatchId) {
    selectedMissingBatchSchools = [];
    renderMissingBatchSchoolFilterOptions();
    clearMissingBatchSchoolFilterSelection();
    clearMissingBatchSearchResults("Select a Missing batch, add schools, then search by student, class, or subject.");
    return;
  }

  const result = await window.appBridge?.listMissingBatchSchools?.({ targetBatchId: selectedMissingBatchId });
  if (!result?.ok) {
    setStatus(result?.message || "Unable to load Missing batch schools.", "error");
    return;
  }

  selectedMissingBatchSchools = Array.isArray(result.data?.schools) ? result.data.schools : [];
  renderMissingBatchSchoolFilterOptions();
  clearMissingBatchSchoolFilterSelection();
  clearMissingBatchSearchResults(
    selectedMissingBatchSchools.length
      ? "Schools loaded. Run a student, class, or subject search to load rows."
      : "No schools added yet. Add schools to the selected Missing batch."
  );
};

const runMissingBatchSearch = async () => {
  if (!selectedMissingBatchId) {
    setStatus("Select a Missing batch first.", "error");
    return;
  }
  if (!selectedMissingBatchSchools.length) {
    setStatus("Add at least one school to the selected Missing batch.", "error");
    return;
  }

  setStatus("Searching source rows for the selected Missing batch...", "");
  const result = await window.appBridge?.searchMissingBatchSourceRows?.({
    targetBatchId: selectedMissingBatchId,
    schoolIds: getSelectedMissingBatchSchoolFilterIds(),
    studentName: String(missingBatchStudentFilterInput?.value || "").trim(),
    className: String(missingBatchClassFilterInput?.value || "").trim(),
    subjectName: String(missingBatchSubjectFilterInput?.value || "").trim(),
  });
  if (!result?.ok) {
    setStatus(result?.message || "Unable to search Missing batch rows.", "error");
    return;
  }

  missingBatchSearchRows = Array.isArray(result.data?.rows) ? result.data.rows : [];
  selectedMissingBatchRowKeys = new Set(missingBatchSearchRows.map((row) => makeRowKey(row)));
  missingBatchSearchMeta = {
    batch_count: Number(result.data?.batch_count || 0),
    row_count: Number(result.data?.row_count || 0),
  };
  renderMissingBatchSearchRows();
  updateRefreshStatus();
  setStatus(
    missingBatchSearchRows.length
      ? `Loaded ${missingBatchSearchRows.length} row${missingBatchSearchRows.length === 1 ? "" : "s"} from ${missingBatchSearchMeta.batch_count || 0} source batch(es).`
      : "No rows match the current student, class, and subject search.",
    missingBatchSearchRows.length ? "success" : ""
  );
};

tabsSection?.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-tab-target]") : null;
  if (!button) return;
  event.preventDefault();
  switchTab(button.getAttribute("data-tab-target") || "school-data-tab");
});

schoolSearchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runSchoolSearch();
});

[schoolStudentFilterInput, schoolSubjectFilterInput].forEach((input) => {
  input?.addEventListener("input", () => {
    applySchoolDataFilters();
    renderSchoolDataRows();
  });
});

createMissingBatchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const batchName = String(missingBatchNameInput?.value || "").trim();
  if (!batchName) {
    setStatus("Missing batch name is required.", "error");
    return;
  }

  setStatus("Creating Missing batch...", "");
  const result = await window.appBridge?.createMissingBatch?.(batchName);
  if (!result?.ok) {
    setStatus(result?.message || "Unable to create Missing batch.", "error");
    return;
  }

  if (missingBatchNameInput) {
    missingBatchNameInput.value = "";
  }
  selectedMissingBatchId = Number(result.data?.id || 0);
  setStatus(`Created ${result.data?.batch_name || "Missing batch"}.`, "success");
  await refreshMissingBatches();
  await refreshSelectedMissingBatchSchools();
  switchTab("missing-batches-tab");
});

missingBatchSelect?.addEventListener("change", async () => {
  selectedMissingBatchId = Number(missingBatchSelect.value || 0);
  if (missingBatchSchoolIdsInput) {
    missingBatchSchoolIdsInput.value = "";
  }
  clearMissingBatchSchoolFilterSelection();
  if (missingBatchStudentFilterInput) {
    missingBatchStudentFilterInput.value = "";
  }
  if (missingBatchClassFilterInput) {
    missingBatchClassFilterInput.value = "";
  }
  if (missingBatchSubjectFilterInput) {
    missingBatchSubjectFilterInput.value = "";
  }
  await refreshSelectedMissingBatchSchools();
});

nonpMissingBatchSelect?.addEventListener("change", () => {
  selectedNonpMissingBatchId = Number(nonpMissingBatchSelect.value || 0);
  updateNonpBooksState();
});

missingBatchSchoolsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedMissingBatchId) {
    setStatus("Select a Missing batch first.", "error");
    return;
  }

  const schoolIds = String(missingBatchSchoolIdsInput?.value || "").trim();
  if (!schoolIds) {
    setStatus("Enter at least one school ID.", "error");
    return;
  }

  setStatus("Adding schools to Missing batch...", "");
  const result = await window.appBridge?.addSchoolsToMissingBatch?.({
    targetBatchId: selectedMissingBatchId,
    schoolIds,
  });
  if (!result?.ok) {
    setStatus(result?.message || "Unable to add schools to Missing batch.", "error");
    return;
  }

  if (missingBatchSchoolIdsInput) {
    missingBatchSchoolIdsInput.value = "";
  }
  selectedMissingBatchSchools = Array.isArray(result.data?.schools) ? result.data.schools : [];
  renderMissingBatchSchoolFilterOptions();
  clearMissingBatchSearchResults("Schools updated. Run a student or subject search to load rows.");
  setStatus(
    `Added ${result.data?.added_count || 0} school(s)${result.data?.skipped_count ? `, skipped ${result.data.skipped_count} existing.` : "."}`,
    "success"
  );
});

missingBatchSearchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runMissingBatchSearch();
});

missingBatchSchoolFilterSelect?.addEventListener("change", () => {
  updateMissingBatchSchoolFilterSummary();
});

selectAllMissingBatchResults?.addEventListener("change", (event) => {
  missingBatchSearchRows.forEach((row) => {
    const rowKey = makeRowKey(row);
    if (event.target.checked) {
      selectedMissingBatchRowKeys.add(rowKey);
    } else {
      selectedMissingBatchRowKeys.delete(rowKey);
    }
  });
  renderMissingBatchSearchRows();
});

addSelectedRowsButton?.addEventListener("click", async () => {
  const selectedRows = missingBatchSearchRows.filter((row) => selectedMissingBatchRowKeys.has(makeRowKey(row)));
  if (!selectedRows.length) {
    setStatus("Select at least one student row first.", "error");
    return;
  }

  await addRowsToSelectedMissingBatch(selectedRows, "selected rows");
});

addLoadedRowsButton?.addEventListener("click", async () => {
  if (!missingBatchSearchRows.length) {
    setStatus("Search and load rows first.", "error");
    return;
  }

  await addRowsToSelectedMissingBatch(missingBatchSearchRows, "loaded rows");
});

addSubjectToMissingBatchButton?.addEventListener("click", async () => {
  await openAddSubjectModal();
});

openAddNonpBooksModalButton?.addEventListener("click", async () => {
  await openAddNonpBooksModal();
});

openAddAllNonpSubjectsModalButton?.addEventListener("click", async () => {
  await openAddAllNonpSubjectsModal();
});

missingBatchesBody?.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest(".missing-batch-action") : null;
  if (!button) return;
  const batchId = Number(button.getAttribute("data-batch-id") || 0);
  const action = String(button.getAttribute("data-action") || "");
  if (!Number.isInteger(batchId) || batchId <= 0 || !action) {
    return;
  }
  await handleMissingBatchAction(batchId, action);
});

pageRefreshButton?.addEventListener("click", async () => {
  updateRefreshStatus();
  await refreshMissingBatches();
  if (activeSchoolId) {
    await runSchoolSearch();
  }
  if (selectedMissingBatchId) {
    await refreshSelectedMissingBatchSchools();
  }
});

downloadCsvButton?.addEventListener("click", async () => {
  if (!activeSchoolId) return;
  setStatus("Preparing CSV export...", "");
  const result = await window.appBridge?.exportMissingBooksCsv?.({ schoolId: activeSchoolId });
  if (!result?.ok) {
    setStatus(result?.message || "Unable to export CSV.", "error");
    return;
  }
  setStatus(`CSV exported: ${result.data?.file_path || "file"}`, "success");
});

downloadJsonButton?.addEventListener("click", async () => {
  if (!activeSchoolId) return;
  setStatus("Preparing JSON export...", "");
  const result = await window.appBridge?.exportMissingBooksJson?.({ schoolId: activeSchoolId });
  if (!result?.ok) {
    setStatus(result?.message || "Unable to export JSON.", "error");
    return;
  }
  setStatus(`JSON exported: ${result.data?.file_path || "file"}`, "success");
});

updateRefreshStatus();
setExportButtonsDisabled(true);
setSchoolFilterInputsEnabled(false);
renderSchoolDataEmptyState("Enter a school ID to load source BookDetails rows.");
renderMissingBatchResultsEmptyState("Select a Missing batch, add schools, then search student or subject.");
updateSchoolSummary();
updateMissingBatchSearchState();
switchTab(tabButtons.find((button) => button.classList.contains("active"))?.dataset.tabTarget || "school-data-tab");
refreshMissingBatches();
