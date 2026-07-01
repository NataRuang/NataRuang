// src/lib/report.js
// Export laporan transaksi ke Excel (SheetJS) dan PDF (jsPDF + AutoTable)

import * as XLSX from 'xlsx'
import jsPDF     from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatRupiah, formatTanggal } from './utils.js'

// ── EXCEL ──────────────────────────────────────────────────

/**
 * Export daftar pesanan ke file Excel
 * @param {Array}  orders     data dari getOrdersExport()
 * @param {string} fileName   nama file tanpa ekstensi
 */
export function exportOrdersExcel(orders, fileName = 'laporan-transaksi') {
  const rows = orders.map(o => ({
    'No. Invoice':      o.invoice_number,
    'Tanggal':          formatTanggal(o.created_at),
    'Nama Pembeli':     o.nama_pembeli,
    'No. WA':           o.nomor_wa,
    'Kota':             o.kota,
    'Provinsi':         o.provinsi,
    'Subtotal':         o.subtotal,
    'Ongkir':           o.ongkir,
    'Total':            o.total,
    'Metode Bayar':     o.payment?.metode || '-',
    'Status Bayar':     o.payment?.status || '-',
    'Status Pesanan':   o.status,
    'Diverifikasi':     o.payment?.verified_at ? formatTanggal(o.payment.verified_at) : '-',
    'Jumlah Item':      o.items?.length || 0
  }))

  const ws = XLSX.utils.json_to_sheet(rows)

  // Auto-width kolom
  const colWidths = Object.keys(rows[0] || {}).map(k =>
    ({ wch: Math.max(k.length, ...rows.map(r => String(r[k] || '').length)) + 2 })
  )
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transaksi')

  // Sheet detail item
  const itemRows = orders.flatMap(o =>
    (o.items || []).map(i => ({
      'No. Invoice':  o.invoice_number,
      'Nama Produk':  i.nama_produk,
      'Kode':         i.kode_produk,
      'Qty':          i.qty,
      'Harga Satuan': i.harga_satuan,
      'Subtotal':     i.subtotal
    }))
  )
  if (itemRows.length) {
    const wsItem = XLSX.utils.json_to_sheet(itemRows)
    XLSX.utils.book_append_sheet(wb, wsItem, 'Detail Item')
  }

  XLSX.writeFile(wb, `${fileName}.xlsx`)
}

// ── PDF ────────────────────────────────────────────────────

/**
 * Export daftar pesanan ke file PDF
 */
export function exportOrdersPDF(orders, namaToko = 'NataRuang', fileName = 'laporan-transaksi') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(namaToko, 14, 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Laporan Transaksi', 14, 20)
  doc.text(`Dicetak: ${new Date().toLocaleDateString('id-ID', { dateStyle: 'long' })}`, 14, 25)

  const kolom = [
    { header: 'Invoice',      dataKey: 'invoice' },
    { header: 'Tanggal',      dataKey: 'tanggal' },
    { header: 'Pembeli',      dataKey: 'pembeli' },
    { header: 'Kota',         dataKey: 'kota' },
    { header: 'Total',        dataKey: 'total' },
    { header: 'Metode',       dataKey: 'metode' },
    { header: 'Status Bayar', dataKey: 'status_bayar' },
    { header: 'Status Order', dataKey: 'status_order' }
  ]

  const baris = orders.map(o => ({
    invoice:      o.invoice_number,
    tanggal:      formatTanggal(o.created_at),
    pembeli:      o.nama_pembeli,
    kota:         o.kota,
    total:        formatRupiah(o.total),
    metode:       o.payment?.metode || '-',
    status_bayar: o.payment?.status || '-',
    status_order: o.status
  }))

  autoTable(doc, {
    columns:    kolom,
    body:       baris,
    startY:     32,
    styles:     { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [44, 44, 42], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 244] },
    margin: { left: 14, right: 14 }
  })

  // Footer halaman
  const totalHalaman = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalHalaman; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.text(`Halaman ${i} dari ${totalHalaman}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 8, { align: 'center' })
  }

  doc.save(`${fileName}.pdf`)
}

/**
 * Cetak Nota Pesanan (satu pesanan)
 */
export function cetakNotaPesanan(order, namaToko = 'NataRuang') {
  const doc = new jsPDF({ unit: 'mm', format: [80, 200] })  // kertas struk

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(namaToko, 40, 8, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('-- NOTA PESANAN --', 40, 14, { align: 'center' })
  doc.text(`Invoice: ${order.invoice_number}`, 4, 20)
  doc.text(`Tanggal: ${formatTanggal(order.created_at)}`, 4, 25)
  doc.text(`Pembeli: ${order.nama_pembeli}`, 4, 30)
  doc.text(`WA: ${order.nomor_wa}`, 4, 35)
  doc.text(`Alamat: ${order.kota}, ${order.provinsi}`, 4, 40)

  doc.line(4, 43, 76, 43)

  let y = 48
  for (const item of (order.items || [])) {
    doc.text(`${item.nama_produk}`, 4, y)
    y += 4
    doc.text(`${item.qty} x ${formatRupiah(item.harga_satuan)}`, 4, y)
    doc.text(formatRupiah(item.subtotal), 76, y, { align: 'right' })
    y += 5
  }

  doc.line(4, y, 76, y)
  y += 4
  doc.text('Subtotal', 4, y)
  doc.text(formatRupiah(order.subtotal), 76, y, { align: 'right' })
  y += 5
  doc.text('Ongkir', 4, y)
  doc.text(formatRupiah(order.ongkir), 76, y, { align: 'right' })
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.text('TOTAL', 4, y)
  doc.text(formatRupiah(order.total), 76, y, { align: 'right' })
  y += 5
  doc.line(4, y, 76, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.text('Status: ' + order.status.replace(/_/g, ' ').toUpperCase(), 4, y)
  y += 8
  doc.text('Terima kasih telah berbelanja!', 40, y, { align: 'center' })

  doc.save(`nota-${order.invoice_number}.pdf`)
}
