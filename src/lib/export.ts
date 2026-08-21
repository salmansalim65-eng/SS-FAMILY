/** CSV export helpers. Excel-safe quoting, UTF-8 BOM for Arabic/Urdu names. */

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n')
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
