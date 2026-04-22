import React, { useState, useEffect } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  query, orderBy, onSnapshot
} from 'firebase/firestore'
import { db } from './firebase'

// ─── Constants ────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = 'jingyu2025'
const OPEN_H = 8, CLOSE_H = 21
const MONTHS_TW = ['一','二','三','四','五','六','七','八','九','十','十一','十二']
const DAYS_TW   = ['日','一','二','三','四','五','六']

const RULES = [
  { icon: '🔑', text: '付款完成後，預約時段開始前 24 小時，將有官方私訊告知鑰匙位置。可於前十分鐘至等候區等候，若工作室無人使用，可提前進入準備。' },
  { icon: '⏱',  text: '請務必遵守房間使用時間，避免造成下一時段使用者困擾。若延誤、超時，每分鐘收費 $10 元。' },
  { icon: '🚭', text: '工作室全面禁止吸菸、飲酒、嚼食檳榔。等候公共區域請勿食用重味道食物並保持安靜。未吃完食物、飲料，請於離場時帶走，切勿丟公共垃圾桶。' },
  { icon: '🧹', text: '離場前請將房間物品歸位，並關閉空調及電燈、打開房門。使用過的一次性床單請丟至等候區公共垃圾桶。' },
  { icon: '👥', text: '租用時段最多接受租用者 + 2 位來賓共 3 人在場，並禁止攜帶寵物。' },
  { icon: '🧽', text: '使用後如有粉塵或色乳遺留須清掃乾淨。破壞設備導致髒亂或使設備無法使用，須以原價賠償。' },
  { icon: '⚖️', text: '租用人不得在空間內進行中華民國法律規定之違法情事，如賭博、吸毒、交易情色等行為，若有違法情事自負法律責任。' },
  { icon: '🔥', text: '空間有火警感應器，禁止使用明火，如打火機、香氛蠟燭等易燃物。' },
  { icon: '📋', text: '本工作室僅提供空間租賃使用。預約完成後，視同租用人同意遵守本使用規則。違反規定或被封鎖人士不歡迎預約。' },
]

const AMENITIES = [
  { icon: '🛏', name: '開洞美容床',        sub: '專業按摩美容床' },
  { icon: '💺', name: '美容椅',            sub: '多功能調整設計' },
  { icon: '🛒', name: '美容推車',          sub: '器材整潔放置' },
  { icon: '💡', name: '35W 調光照燈',      sub: '專業補光調色溫' },
  { icon: '🧴', name: '紫外線毛巾加熱機',  sub: '確保衛生標準' },
  { icon: '❄️', name: '分離式冷氣',        sub: '四季恆溫舒適' },
  { icon: '📶', name: '100M 光纖網路',     sub: '高速穩定不中斷' },
  { icon: '🎵', name: 'Apple HomePod',     sub: '質感氛圍音樂' },
  { icon: '🪞', name: '全身鏡・衣帽架',   sub: '舒適更衣空間' },
  { icon: '🧻', name: '一次性床單',        sub: '衛生安全保障' },
  { icon: '🧴', name: '酒精噴霧',          sub: '環境消毒必備' },
  { icon: '🚿', name: '獨立淋浴間',        sub: '乾濕分離，適合除毛美體' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad    = n => (n < 10 ? '0' : '') + n
const fmtDate = d => { if (!d) return '—'; const [y,m,day]=d.split('-'); return `${y}年${+m}月${+day}日` }
const fmtTime = (h,m) => pad(h)+':'+pad(m)
const addMin  = (h,m,mins) => { const t=h*60+m+mins; return {h:Math.floor(t/60),m:t%60} }
const todayISO = () => new Date().toISOString().split('T')[0]

// ─── Firebase helpers ─────────────────────────────────────────────────────────
const COL = 'bookings'
const BLOCK_COL = 'blocked_slots'
async function fbAdd(data)   { return addDoc(collection(db, COL), data) }
async function fbUpdate(id, data) { return updateDoc(doc(db, COL, id), data) }
async function fbDelete(id)  { return deleteDoc(doc(db, COL, id)) }

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]         = useState('booking')
  const [bookings, setBookings] = useState([])
  const [loading, setLoading]   = useState(true)
  const [toast, setToast]      = useState(null)

  // Admin
  const [isAdmin, setIsAdmin]     = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [pwInput, setPwInput]     = useState('')
  const [pwErr, setPwErr]         = useState(false)
  const [blockedSlots, setBlockedSlots] = useState([])
  const [blockDate, setBlockDate]   = useState(todayISO())
  const [blockSelSlots, setBlockSelSlots] = useState([])
  const [blockNote, setBlockNote]   = useState('')
  const [blockLoading, setBlockLoading] = useState(false)

  // Booking form
  const [plan, setPlan]         = useState('A')
  const [hours, setHours]       = useState(2)
  const [days, setDays]         = useState(1)
  const [extraHalf, setExtraHalf] = useState(false)
  const [date, setDate]         = useState(todayISO())
  const [slot, setSlot]         = useState(null)
  const [name, setName]         = useState('')
  const [phone, setPhone]       = useState('')
  const [note, setNote]         = useState('')
  const [agreed, setAgreed]     = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Calendar
  const now = new Date()
  const [calY, setCalY] = useState(now.getFullYear())
  const [calM, setCalM] = useState(now.getMonth())
  const [calDay, setCalDay] = useState(null)

  // ── Firebase realtime listener ────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, COL), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setBookings(snap.docs.map(d => ({ ...d.data(), _id: d.id })))
      setLoading(false)
    }, err => {
      console.error(err)
      setLoading(false)
    })
    return unsub
  }, [])

  // ── Blocked slots listener ───────────────────────────────────────────────
  useEffect(() => {
    const q2 = query(collection(db, BLOCK_COL), orderBy('createdAt', 'desc'))
    const unsub2 = onSnapshot(q2, snap => {
      setBlockedSlots(snap.docs.map(d => ({ ...d.data(), _id: d.id })))
    }, err => console.error(err))
    return unsub2
  }, [])

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  // ── Price / duration ──────────────────────────────────────────────────────
  const calcPrice  = () => plan === 'B' ? 800 * days : 150 * hours + (extraHalf ? 75 : 0)
  const calcDurMin = () => plan === 'B' ? days * 8 * 60 : hours * 60 + (extraHalf ? 30 : 0)

  // ── Taken slots ───────────────────────────────────────────────────────────
  function getTakenSlots(d) {
    const s = new Set()
    bookings
      .filter(b => b.date === d && b.status !== 'cancelled')
      .forEach(b => {
        let cur = b.startH * 60 + b.startM
        for (let i = 0; i < b.durMin; i += 30) {
          s.add(fmtTime(Math.floor(cur / 60), cur % 60)); cur += 30
        }
      })
    blockedSlots
      .filter(b => b.date === d)
      .forEach(b => { b.slots.forEach(sl => s.add(sl)) })
    return s
  }

  function allSlots() {
    const s = []
    for (let h = OPEN_H; h < CLOSE_H; h++)
      for (let m = 0; m < 60; m += 30) s.push(fmtTime(h, m))
    return s
  }

  // ── Submit booking ────────────────────────────────────────────────────────
  async function submitBooking() {
    if (!name.trim())  { showToast('請填寫租用人姓名', 'err'); return }
    if (!phone.trim()) { showToast('請填寫聯絡電話', 'err'); return }
    if (!date)          { showToast('請選擇日期', 'err'); return }
    if (!slot)          { showToast('請選擇開始時間', 'err'); return }
    if (!agreed)       { showToast('請閱讀並同意使用規則', 'err'); return }

    const [sh, sm] = slot.split(':').map(Number)
    const durMin   = calcDurMin()
    const end      = addMin(sh, sm, durMin)

    if (end.h > CLOSE_H || (end.h === CLOSE_H && end.m > 0)) {
      showToast(`結束時間 ${fmtTime(end.h, end.m)} 超出營業時間 21:00`, 'err'); return
    }

    const taken = getTakenSlots(date)
    let cur = sh * 60 + sm
    for (let i = 0; i < durMin; i += 30) {
      if (taken.has(fmtTime(Math.floor(cur / 60), cur % 60))) {
        showToast('所選時段與現有預約重疊，請重新選擇', 'err'); return
      }
      cur += 30
    }

    setSubmitting(true)
    try {
      await fbAdd({
        plan, date,
        startH: sh, startM: sm,
        durMin,
        price: calcPrice(),
        name:  name.trim(),
        phone: phone.trim(),
        note:  note.trim(),
        status: 'confirmed',
        createdAt: new Date().toISOString(),
      })
      showToast(`✓ 預約成功！${name.trim()} ${fmtDate(date)} ${slot} 起`)
      setSlot(null); setName(''); setPhone(''); setNote(''); setAgreed(false)
    } catch (e) {
      console.error('Firebase error:', e)
      showToast('❌ 儲存失敗，請檢查網路或權限', 'err')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Google Calendar ───────────────────────────────────────────────────────
  function addToGCal() {
    if (!date || !slot) { showToast('請先選擇日期與時間', 'err'); return }
    const [sh, sm]     = slot.split(':').map(Number)
    const [y, mo, d]   = date.split('-').map(Number)
    const start        = new Date(y, mo - 1, d, sh, sm)
    const end          = new Date(start.getTime() + calcDurMin() * 60000)
    const fmt          = dt => dt.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z'
    const title        = encodeURIComponent(`京雨美學坊租用 – ${name || '未填姓名'}`)
    const loc          = encodeURIComponent('嘉義市秀園新村 No.5, 2F')
    const det          = encodeURIComponent(`方案：${plan==='A'?'時租 A 方案':'日租 B 方案'}\n費用：$${calcPrice()}\n${note}`)
    window.open(`https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&location=${loc}&details=${det}`, '_blank')
  }

  // ── Admin actions ─────────────────────────────────────────────────────────
  async function adminSetStatus(id, status) {
    try { await fbUpdate(id, { status }); showToast(status === 'cancelled' ? '已取消預約' : '已恢復預約') }
    catch { show
