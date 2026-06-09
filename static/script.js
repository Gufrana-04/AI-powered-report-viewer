let allData = [];
let filteredData = [];
let currentQuery = "";
const selectedIndexes = new Set();

// Cache AI results so we don't re-call for the same row
const aiCache = new Map();

// Sort state
let sortColumn = null;
let sortDirection = "asc"; // "asc" or "desc"
let lastHeaders = null; // Cache headers to avoid rebuilding
let renderFrameId = null; // Track pending render

const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const searchInput = document.getElementById("searchInput");
const uploadFeedback = document.getElementById("uploadFeedback");
const detailContent = document.getElementById("detailContent");

uploadBtn.addEventListener("click", uploadFile);
fileInput.addEventListener("change", renderPendingFileState);
searchInput.addEventListener("input", handleSearch);

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatchText(value, query) {
    const safeText = escapeHtml(value ?? "");

    if (!query) {
        return safeText;
    }

    const pattern = new RegExp(`(${escapeRegExp(query)})`, "ig");
    return safeText.replace(pattern, '<span class="match-highlight">$1</span>');
}

async function parseResponseSafely(response) {
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    if (!text) {
        return {};
    }

    if (contentType.includes("application/json") || /^[\[{]/.test(text.trim())) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return { success: false, error: "Server returned invalid JSON" };
        }
    }

    return { success: false, error: "Server returned an unexpected response" };
}

function renderPendingFileState() {
    if (!fileInput.files.length) {
        uploadFeedback.innerHTML = "";
        return;
    }

    const fileName = escapeHtml(fileInput.files[0].name);

    uploadFeedback.innerHTML = `
        <span class="upload-badge">
            Selected: ${fileName}
        </span>
    `;
}

function renderUploadSuccess(fileName) {
    uploadFeedback.innerHTML = `
        <span class="upload-badge">
            Upload successful: ${escapeHtml(fileName)}
            <button id="removeUploadBtn" class="remove-upload" type="button" aria-label="Remove uploaded file">x</button>
        </span>
    `;

    const removeUploadBtn = document.getElementById("removeUploadBtn");
    removeUploadBtn.addEventListener("click", removeUploadedFile);
}

function removeUploadedFile() {
    fileInput.value = "";
    allData = [];
    filteredData = [];
    currentQuery = "";
    selectedIndexes.clear();
    aiCache.clear();
    searchInput.value = "";
    uploadFeedback.innerHTML = "";

    renderTable([]);
    renderDetailPanel();
}

async function uploadFile() {
    if (!fileInput.files.length) {
        alert("Please select a file");
        return;
    }

    const selectedFile = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
        const response = await fetch("/upload", {
            method: "POST",
            body: formData
        });

        const result = await parseResponseSafely(response);

        if (!response.ok || !result.success) {
            alert(result.error || "Upload failed");
            return;
        }

        allData = result.rows.map((row, index) => ({
            ...row,
            _index: index
        }));
        filteredData = [...allData];
        selectedIndexes.clear();
        aiCache.clear();

        renderUploadSuccess(selectedFile.name);
        renderTable(filteredData);
        renderDetailPanel();

    } catch (error) {
        console.error(error);
        alert("Error uploading file");
    }
}

function sortData(data, column) {
    // Toggle sort direction if same column is clicked
    if (sortColumn === column) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
        sortColumn = column;
        sortDirection = "asc";
    }

    // Show loading state
    const tableBody = document.getElementById("tableBody");
    if (tableBody) {
        tableBody.style.opacity = "0.6";
    }

    const sorted = [...data].sort((a, b) => {
        const aVal = a.raw[column];
        const bVal = b.raw[column];

        // Handle null/undefined
        const aIsEmpty = aVal === null || aVal === undefined || String(aVal).toLowerCase() === "nan";
        const bIsEmpty = bVal === null || bVal === undefined || String(bVal).toLowerCase() === "nan";

        if (aIsEmpty && bIsEmpty) return 0;
        if (aIsEmpty) return 1;
        if (bIsEmpty) return -1;

        // Try numeric sort first
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);

        if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
        }

        // Fall back to string sort
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();

        return sortDirection === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });

    return sorted;
}

function renderTableHeaders(headers) {
    // Only rebuild headers if structure changed
    if (lastHeaders && JSON.stringify(lastHeaders) === JSON.stringify(headers)) {
        return; // Headers unchanged, just update sort indicators
    }

    lastHeaders = headers;
    const tableHead = document.getElementById("tableHead");
    tableHead.innerHTML = "";
    const headerRow = document.createElement("tr");

    headers.forEach((header) => {
        const th = document.createElement("th");
        th.classList.add("sortable-header");
        th.style.cursor = "pointer";
        th.textContent = header;

        // Add sort indicator
        if (sortColumn === header) {
            const indicator = document.createElement("span");
            indicator.className = "sort-indicator";
            indicator.textContent = sortDirection === "asc" ? " ▲" : " ▼";
            th.appendChild(indicator);
        }

        // Add click handler for sorting
        th.addEventListener("click", () => {
            const sorted = sortData(filteredData, header);
            renderTableBody(sorted, headers);
        });

        headerRow.appendChild(th);
    });

    tableHead.appendChild(headerRow);
}

function renderTableBody(data, headers) {
    // Cancel previous pending render
    if (renderFrameId) {
        cancelAnimationFrame(renderFrameId);
    }

    // Defer rendering to next frame for better performance
    renderFrameId = requestAnimationFrame(() => {
        const tableBody = document.getElementById("tableBody");
        tableBody.innerHTML = "";

        data.forEach((rowData) => {
            const tr = document.createElement("tr");

            if (selectedIndexes.has(rowData._index)) {
                tr.classList.add("selected-row");
            }

            headers.forEach((header) => {
                const td = document.createElement("td");
                td.innerHTML = highlightMatchText(rowData.raw[header] || "", currentQuery);
                tr.appendChild(td);
            });

            tr.addEventListener("click", () => {
                toggleRowSelection(rowData._index);
                tr.classList.toggle("selected-row", selectedIndexes.has(rowData._index));
                renderDetailPanel();
            });

            tableBody.appendChild(tr);
        });

        // Restore normal opacity
        tableBody.style.opacity = "1";
        renderFrameId = null;
    });
}

function renderTable(data) {
    const recordCount = document.getElementById("recordCount");

    if (!data.length) {
        recordCount.innerText = "0 Records";
        const tableBody = document.getElementById("tableBody");
        tableBody.innerHTML = "";
        return;
    }

    recordCount.innerText = `${data.length} Records`;

    const headers = data[0].headers;
    renderTableHeaders(headers);
    renderTableBody(data, headers);
}

function handleSearch(event) {
    currentQuery = event.target.value.trim();

    if (!currentQuery) {
        filteredData = [...allData];
        // Reapply current sort
        if (sortColumn) {
            filteredData = sortData(filteredData, sortColumn);
        }
        renderTable(filteredData);
        renderDetailPanel();
        return;
    }

    const searchTerm = currentQuery.toLowerCase();

    filteredData = allData.filter((row) => {
        const rawValues = Object.values(row.raw)
            .join(" ")
            .toLowerCase();

        const normalizedValues = Object.values(row.normalized)
            .join(" ")
            .toLowerCase();

        return rawValues.includes(searchTerm) || normalizedValues.includes(searchTerm);
    });

    // Reapply current sort
    if (sortColumn && filteredData.length > 0) {
        filteredData = sortData(filteredData, sortColumn);
    }
    if (filteredData.length > 0) {
        const headers = filteredData[0].headers;
        renderTableHeaders(headers);
        renderTableBody(filteredData, headers);
    } else {
        renderTable(filteredData);
    }
    renderDetailPanel();
}

function toggleRowSelection(index) {
    if (selectedIndexes.has(index)) {
        selectedIndexes.delete(index);
        return;
    }

    selectedIndexes.add(index);
}

async function fetchAiNormalized(rowData) {
    const cacheKey = rowData._index;

    // Return cached result if available
    if (aiCache.has(cacheKey)) {
        return aiCache.get(cacheKey);
    }

    try {
        const response = await fetch("/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ raw: rowData.raw })
        });

        const result = await response.json();

        if (result.success) {
            aiCache.set(cacheKey, result.normalized);
            return result.normalized;
        }

    } catch (err) {
        console.error("AI analyze failed:", err);
    }

    // Fallback to original normalized if AI fails
    return null;
}

async function renderDetailPanel() {
    detailContent.innerHTML = "";

    if (!selectedIndexes.size) {
        detailContent.innerHTML = '<div class="empty-state">Select one or more rows to view details</div>';
        return;
    }

    const labels = {
        module: "Module",
        menu: "Menu",
        submenu: "Submenu",
        report_name: "Report Name",
        report_path: "Report Flow Path",
        status: "Status",
        remark: "Remark"
    };

    const selectedRows = allData.filter((row) => selectedIndexes.has(row._index));

    // Render loading state first for all selected rows
    selectedRows.forEach((row, rowPosition) => {
        const title = document.createElement("h3");
        title.className = "detail-group-title";
        title.id = `row-title-${row._index}`;
        title.textContent = `Selected Row ${rowPosition + 1}`;
        detailContent.appendChild(title);

        const placeholder = document.createElement("div");
        placeholder.className = "ai-loading";
        placeholder.id = `ai-placeholder-${row._index}`;
        placeholder.innerHTML = `<span class="ai-loading-text">✦ AI is analyzing this row...</span>`;
        detailContent.appendChild(placeholder);
    });

    // Now fetch AI results and replace placeholders one by one
    for (const row of selectedRows) {
        const normalized = await fetchAiNormalized(row);
        const displayData = normalized || row.normalized;
        const isAi = !!normalized;

        const placeholder = document.getElementById(`ai-placeholder-${row._index}`);

        if (!placeholder) continue;

        const table = document.createElement("table");
        table.className = "detail-table";

        // AI badge row
        if (isAi) {
            const badgeTr = document.createElement("tr");
            const badgeTd = document.createElement("td");
            badgeTd.colSpan = 2;
            badgeTd.innerHTML = `<span class="ai-badge">✦ AI Enhanced</span>`;
            badgeTr.appendChild(badgeTd);
            table.appendChild(badgeTr);
        }

        const tbody = document.createElement("tbody");

        Object.entries(labels).forEach(([key, label]) => {
            const value = displayData[key];

            if (!value) return;

            const tr = document.createElement("tr");

            const th = document.createElement("th");
            th.textContent = label;

            const td = document.createElement("td");
            td.innerHTML = highlightMatchText(value, currentQuery);

            tr.appendChild(th);
            tr.appendChild(td);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        placeholder.replaceWith(table);
    }
}

renderTable([]);
renderDetailPanel();