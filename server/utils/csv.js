const dangerousPrefix = /^[=+\-@]/;

function cell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value).replaceAll('"', '""');
  if (dangerousPrefix.test(text)) text = `'${text}`;
  return `"${text}"`;
}

function sendCsv(res, filename, headers, rows) {
  const lines = [
    headers.map(cell).join(";"),
    ...rows.map((row) => row.map(cell).join(";")),
  ];
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
  res.send(`\uFEFF${lines.join("\r\n")}`);
}

module.exports = { sendCsv };
