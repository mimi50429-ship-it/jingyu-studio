import { useState, useEffect, useCallback } from 'react'
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
  query, orderBy, onSnapshot
} from 'firebase/firestore'
import { db } from './firebase'

// ─── Constants ────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = 'jingyu2025'   // ← 可在此更改管理員密碼
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
  const [loading, setLoading]  = useState(true)
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
  const [hours, setHours]       = useState(1)
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
    // also add manually blocked slots
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
    if (!date)         { showToast('請選擇日期', 'err'); return }
    if (!slot)         { showToast('請選擇開始時間', 'err'); return }
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
      if (e.code === 'permission-denied') {
        showToast('❌ 權限錯誤：請至 Firebase Console > Firestore > 規則，設定允許讀寫', 'err')
      } else {
        showToast('❌ 儲存失敗：' + (e.message || '請檢查網路'), 'err')
      }
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
    catch { showToast('操作失敗', 'err') }
  }
  async function adminDelete(id) {
    if (!window.confirm('確定刪除此預約紀錄？')) return
    try { await fbDelete(id); showToast('已刪除紀錄') }
    catch { showToast('刪除失敗', 'err') }
  }

  // ── Block slots ──────────────────────────────────────────────────────────
  async function adminBlockSlots() {
    if (!blockDate || blockSelSlots.length === 0) { showToast('請選擇日期與時段', 'err'); return }
    setBlockLoading(true)
    try {
      await addDoc(collection(db, BLOCK_COL), {
        date: blockDate,
        slots: blockSelSlots,
        note: blockNote.trim() || '管理員封鎖',
        createdAt: new Date().toISOString(),
      })
      showToast(`✓ 已封鎖 ${blockSelSlots.length} 個時段`)
      setBlockSelSlots([]); setBlockNote('')
    } catch(e) { showToast('封鎖失敗：'+e.message, 'err') }
    setBlockLoading(false)
  }
  async function adminUnblock(id) {
    try { await deleteDoc(doc(db, BLOCK_COL, id)); showToast('已解除封鎖') }
    catch { showToast('操作失敗', 'err') }
  }

  // ── Calendar cells ────────────────────────────────────────────────────────
  const firstDow  = new Date(calY, calM, 1).getDay()
  const daysInM   = new Date(calY, calM + 1, 0).getDate()
  const prevDays  = new Date(calY, calM, 0).getDate()
  const calCells  = []
  for (let i = 0; i < firstDow; i++) calCells.push({ day: prevDays - firstDow + i + 1, cur: false })
  for (let d = 1; d <= daysInM; d++)  calCells.push({ day: d, cur: true })
  const rem = (firstDow + daysInM) % 7 === 0 ? 0 : 7 - (firstDow + daysInM) % 7
  for (let i = 1; i <= rem; i++)       calCells.push({ day: i, cur: false })

  const calDS   = d => `${calY}-${pad(calM+1)}-${pad(d)}`
  const hasBk   = d => bookings.some(b => b.date === calDS(d) && b.status !== 'cancelled')
  const todayS  = todayISO()
  const calDayBk = calDay ? bookings.filter(b => b.date === calDay).sort((a,b2) => a.startH*60+a.startM-(b2.startH*60+b2.startM)) : []

  // Stats
  const active       = bookings.filter(b => b.status !== 'cancelled')
  const todayCount   = active.filter(b => b.date === todayS).length
  const mPrefix      = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const monthCount   = active.filter(b => b.date.startsWith(mPrefix)).length
  const monthRevenue = active.filter(b => b.date.startsWith(mPrefix)).reduce((s,b) => s+b.price, 0)

  const taken = getTakenSlots(date)
  const slots = allSlots()

  // ── Styles ────────────────────────────────────────────────────────────────
  const C = {
    sage:'#DFA0AA',        // Sea Pink - 按鈕、選中狀態
    sageDark:'#845F4A',    // Roman Coffee - 強調、標題
    sageLight:'#F5E8E0',   // 淺粉膚色 - 背景點綴
    cream:'#F0EDDC',       // Eggshell 主背景
    border:'#D9D0BC',      // Stone 邊框
    muted:'#B9AC8C',       // Stone 次要文字
    text:'#4A3728',        // 深棕主文字
    gold:'#B9AC8C',        // Stone 點綴
    white:'#FDFAF5',       // 暖白卡片
    danger:'#C0392B',
    success:'#7A9178',
  }
  const card  = { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: '1rem' }
  const cHead = { padding: '1rem 1.4rem', borderBottom: `1px solid ${C.border}`, fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }
  const cBody = { padding: '1.4rem' }
  const lbl   = { fontSize: 12, color: C.muted, marginBottom: 5, display: 'block', letterSpacing: '0.03em' }
  const inp   = { width: '100%', border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: 'inherit', color: C.text, background: C.white, outline: 'none' }
  const btn   = (v='primary') => ({
    border: 'none', borderRadius: 9, padding: '10px 16px', fontSize: 13, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.04em', transition: 'all .2s',
    ...(v==='primary'  ? {background:C.sageDark, color:'#fff'} : {}),
    ...(v==='outline'  ? {background:C.white,   color:C.text,    border:`1px solid ${C.border}`} : {}),
    ...(v==='danger'   ? {background:C.white,   color:C.danger,  border:`1px solid #F0C0C0`} : {}),
    ...(v==='success'  ? {background:C.white,   color:C.success, border:`1px solid #C0DCC0`} : {}),
    ...(v==='gold'     ? {background:'#EDE7D9', color:C.sageDark, border:`1px solid ${C.border}`} : {}),
  })
  const tabStyle = (active) => ({
    padding: '0.8rem 1rem', fontSize: 13, cursor: 'pointer',
    borderBottom: active ? `2px solid ${C.sage}` : '2px solid transparent',
    color: active ? C.sageDark : C.muted,
    background: 'none', border: 'none',
    borderBottom: active ? `2px solid ${C.sage}` : '2px solid transparent',
    fontFamily: 'inherit', letterSpacing: '0.03em', transition: 'all .2s',
  })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Noto Sans TC', sans-serif", minHeight: '100vh', background: C.cream, color: C.text, letterSpacing: '0.01em' }}>

      {/* ── Header ── */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, background: C.sageDark, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontFamily: 'Noto Serif TC, serif', flexShrink: 0 }}>京</div>
          <div>
            <div style={{ fontFamily: 'Noto Serif TC, serif', fontSize: 17, fontWeight: 400, letterSpacing: '0.05em' }}>京雨美學坊</div>
            <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em' }}>嘉義市秀園新村 No.5, 2F</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 12, color: C.muted, textAlign: 'right', lineHeight: 1.7 }}>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>工作室出租系統</div>
            <div>營業 08:00 – 21:00</div>
          </div>
          {isAdmin
            ? <button style={{ ...btn('gold'), fontSize: 12, padding: '6px 12px' }} onClick={() => { setIsAdmin(false); setTab('booking') }}>登出管理</button>
            : <button style={{ ...btn('outline'), fontSize: 12, padding: '6px 12px' }} onClick={() => setShowLogin(true)}>管理員登入</button>
          }
        </div>
      </div>

      {/* ── Admin login modal ── */}
      {showLogin && !isAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,44,42,0.55)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.white, borderRadius: 14, padding: '2rem', width: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
            <div style={{ fontFamily: 'Noto Serif TC, serif', fontSize: 18, marginBottom: '1.2rem' }}>管理員登入</div>
            <input type="password" placeholder="請輸入管理員密碼" value={pwInput}
              onChange={e => { setPwInput(e.target.value); setPwErr(false) }}
              onKeyDown={e => { if (e.key==='Enter') tryLogin() }}
              style={{ ...inp, marginBottom: '0.5rem', borderColor: pwErr ? '#E8A8A8' : C.border }}
              autoFocus />
            {pwErr && <div style={{ fontSize: 12, color: C.danger, marginBottom: '0.5rem' }}>密碼錯誤，請再試</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: '0.8rem' }}>
              <button style={{ ...btn('primary'), flex: 1 }} onClick={tryLogin}>登入</button>
              <button style={{ ...btn('outline'), flex: 1 }} onClick={() => { setShowLogin(false); setPwInput(''); setPwErr(false) }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, display: 'flex', padding: '0 1.5rem', gap: 2 }}>
        {[['booking','預約租用'],['calendar','日曆總覽'],['rules','注意事項'],['space','空間介紹'],
          ...(isAdmin ? [['admin','管理後台']] : [])
        ].map(([id, label]) => (
          <button key={id} style={tabStyle(tab===id)} onClick={() => setTab(id)}>
            {label}
            {id==='admin' && <span style={{ marginLeft:4, fontSize:10, background:C.gold, color:'#fff', borderRadius:4, padding:'1px 5px' }}>管</span>}
          </button>
        ))}
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background: toast.type==='err' ? C.danger : C.text, color:'#fff', padding:'11px 20px', borderRadius:10, fontSize:13, zIndex:100, whiteSpace:'nowrap', boxShadow:'0 4px 16px rgba(0,0,0,.2)', letterSpacing:'0.02em' }}>
          {toast.msg}
        </div>
      )}

      {/* ═══════════════ BOOKING ═══════════════ */}
      {tab==='booking' && (
        <div style={{ padding:'1.5rem', maxWidth:940, margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:'1.2rem' }}>
            <div>
              {/* Plan selector */}
              <div style={card}>
                <div style={cHead}>選擇方案</div>
                <div style={cBody}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:'1.2rem' }}>
                    {[['A','時租','$150','/ 1h','1小時起租，每追加30分 $75'],
                      ['B','日租','$800','/ 8h', '每日8小時整包，適合全日服務']].map(([p,l,price,unit,n]) => (
                      <div key={p} onClick={() => { setPlan(p); setExtraHalf(false) }}
                        style={{ border:`1.5px solid ${plan===p ? C.sage : C.border}`, borderRadius:10, padding:'1rem', cursor:'pointer', background: plan===p ? 'rgba(139,158,139,0.06)' : C.white, position:'relative', transition:'all .2s' }}>
                        <div style={{ fontSize:11, fontWeight:500, color:C.sageDark, letterSpacing:'0.06em', marginBottom:3 }}>{p} 方案・{l}</div>
                        <div style={{ fontFamily:'Noto Serif TC, serif', fontSize:22 }}>
                          {price}<span style={{ fontSize:12, color:C.muted, fontFamily:'inherit' }}> {unit}</span>
                        </div>
                        <div style={{ fontSize:11, color:C.muted, marginTop:4, lineHeight:1.6 }}>{n}</div>
                        <div style={{ position:'absolute', top:10, right:10, width:18, height:18, borderRadius:'50%', background: plan===p ? C.sage : C.white, border:`1.5px solid ${plan===p ? C.sage : C.border}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {plan===p && <div style={{ width:6, height:6, borderRadius:'50%', background:'#fff' }} />}
                        </div>
                      </div>
                    ))}
                  </div>

                  {plan==='A' ? (
                    <div>
                      <div style={lbl}>租用時數</div>
                      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <StepBtn onClick={() => setHours(h => Math.max(1,h-1))}>−</StepBtn>
                        <div style={{ textAlign:'center', minWidth:50 }}>
                          <div style={{ fontSize:20, fontWeight:500 }}>{hours}</div>
                          <div style={{ fontSize:11, color:C.muted }}>小時</div>
                        </div>
                        <StepBtn onClick={() => setHours(h => h+1)}>＋</StepBtn>
                        <button onClick={() => setExtraHalf(x => !x)}
                          style={{ marginLeft:8, border:`1px solid ${extraHalf ? C.sage : C.border}`, borderRadius:7, padding:'5px 12px', fontSize:12, cursor:'pointer', background: extraHalf ? 'rgba(139,158,139,0.1)' : C.white, color: extraHalf ? C.sageDark : C.muted, fontFamily:'inherit', transition:'all .2s' }}>
                          +30分 $75
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={lbl}>租用天數</div>
                      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <StepBtn onClick={() => setDays(d => Math.max(1,d-1))}>−</StepBtn>
                        <div style={{ textAlign:'center', minWidth:50 }}>
                          <div style={{ fontSize:20, fontWeight:500 }}>{days}</div>
                          <div style={{ fontSize:11, color:C.muted }}>天</div>
                        </div>
                        <StepBtn onClick={() => setDays(d => d+1)}>＋</StepBtn>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Date & slots */}
              <div style={card}>
                <div style={cHead}>選擇日期與時段</div>
                <div style={cBody}>
                  <div style={{ marginBottom:'1rem' }}>
                    <div style={lbl}>日期</div>
                    <input type="date" style={inp} value={date} min={todayS}
                      onChange={e => { setDate(e.target.value); setSlot(null) }} />
                  </div>
                  <div style={lbl}>開始時間（灰色為已租用）</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:5, marginTop:6 }}>
                    {slots.map(sl => {
                      const tk = taken.has(sl), sel = slot===sl
                      return (
                        <div key={sl} onClick={() => !tk && setSlot(sl)}
                          style={{ padding:'7px 4px', border:`1px solid ${sel ? C.sage : tk ? '#E8E5DF' : C.border}`, borderRadius:7, textAlign:'center', fontSize:12, cursor: tk ? 'not-allowed' : 'pointer', background: sel ? C.sage : tk ? '#F5F3EE' : C.white, color: sel ? '#fff' : tk ? '#C0BCB3' : C.text, transition:'all .15s' }}>
                          {sl}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display:'flex', gap:14, fontSize:11, color:C.muted, marginTop:10 }}>
                    <span>○ 可預約</span><span style={{ color:C.sageDark }}>● 已選</span><span style={{ color:'#C0BCB3' }}>× 已租用</span>
                  </div>

                  <div style={{ height:1, background:'#E8E5DF', margin:'1.2rem 0' }} />

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                    <div><div style={lbl}>租用人姓名 *</div><input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="姓名" /></div>
                    <div><div style={lbl}>聯絡電話 *</div><input style={inp} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0912-345-678" /></div>
                  </div>
                  <div style={lbl}>備註（服務項目）</div>
                  <textarea style={{ ...inp, resize:'none', lineHeight:1.6 }} rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="例：美體服務、除毛項目…" />

                  {/* Rules agreement */}
                  <div style={{ marginTop:'1rem', background:'#F7F4EE', borderRadius:10, padding:'1rem', border:'1px solid #E8E5DF' }}>
                    <div style={{ fontSize:12, color:C.sageDark, fontWeight:500, marginBottom:6 }}>使用規則摘要</div>
                    <div style={{ fontSize:12, color:C.muted, lineHeight:1.8, marginBottom:10 }}>
                      超時每分鐘 $10・全面禁菸禁酒・最多3人・禁明火・設備損壞原價賠償・違法行為自負責任
                    </div>
                    <label style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer', fontSize:12 }}>
                      <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{ marginTop:2, accentColor:C.sage }} />
                      <span>我已閱讀並同意遵守
                        <span style={{ color:C.sageDark, cursor:'pointer', textDecoration:'underline', marginLeft:2 }} onClick={() => setTab('rules')}>《注意事項與規範》</span>
                        ，預約完成即視同接受本規則。
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary sidebar */}
            <div>
              <div style={{ ...card, position:'sticky', top:16 }}>
                <div style={cHead}>費用摘要</div>
                <div style={cBody}>
                  {[['方案', plan==='A' ? 'A 方案・時租' : 'B 方案・日租'],
                    ['日期', fmtDate(date)],
                    ['時段', slot ? slot+' 起' : '—'],
                    ['時數/天數', plan==='A' ? `${hours+(extraHalf?0.5:0)} 小時` : `${days} 天`],
                  ].map(([k,v]) => (
                    <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:`1px solid #E8E5DF`, fontSize:13 }}>
                      <span style={{ color:C.muted }}>{k}</span><span style={{ fontWeight:500 }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:12, marginTop:8, borderTop:`1.5px solid ${C.border}` }}>
                    <span style={{ fontSize:13, fontWeight:500 }}>合計</span>
                    <span style={{ fontFamily:'Noto Serif TC, serif', fontSize:26, color:C.sageDark }}>${calcPrice()}</span>
                  </div>
                  <button onClick={addToGCal} style={{ ...btn('outline'), width:'100%', marginTop:10, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                    <span style={{ fontSize:16 }}>📅</span> 加入 Google 日曆
                  </button>
                  <button onClick={submitBooking} disabled={submitting}
                    style={{ ...btn('primary'), width:'100%', marginTop:8, opacity: submitting ? 0.7 : 1 }}>
                    {submitting ? '送出中…' : '確認預約'}
                  </button>
                  <div style={{ fontSize:11, color:C.muted, textAlign:'center', marginTop:10, lineHeight:1.7 }}>
                    如需取消請提前 24 小時告知<br/>資料即時同步至雲端資料庫
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ CALENDAR ═══════════════ */}
      {tab==='calendar' && (
        <div style={{ padding:'1.5rem', maxWidth:900, margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:'1.2rem' }}>
            <div style={card}>
              <div style={cBody}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.2rem' }}>
                  <StepBtn onClick={() => { if(calM===0){setCalM(11);setCalY(y=>y-1)}else setCalM(m=>m-1) }}>‹</StepBtn>
                  <div style={{ fontFamily:'Noto Serif TC, serif', fontSize:18 }}>{calY}年 {MONTHS_TW[calM]}月</div>
                  <StepBtn onClick={() => { if(calM===11){setCalM(0);setCalY(y=>y+1)}else setCalM(m=>m+1) }}>›</StepBtn>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3 }}>
                  {DAYS_TW.map(d => <div key={d} style={{ textAlign:'center', fontSize:11, color:C.muted, padding:'5px 0' }}>{d}</div>)}
                  {calCells.map((c,i) => {
                    const ds  = c.cur ? calDS(c.day) : null
                    const sel = ds===calDay
                    const tod = ds===todayS
                    const has = c.cur && hasBk(c.day)
                    return (
                      <div key={i} onClick={() => c.cur && setCalDay(ds)}
                        style={{ aspectRatio:'1', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', borderRadius:8, cursor: c.cur ? 'pointer' : 'default', background: sel ? C.sage : 'transparent', color: sel ? '#fff' : c.cur ? (tod ? C.sageDark : C.text) : '#C8C5BF', fontWeight: tod ? 600 : 400, fontSize:13, gap:2, transition:'all .15s', userSelect:'none' }}>
                        {c.day}
                        {has && <div style={{ width:5, height:5, borderRadius:'50%', background: sel ? 'rgba(255,255,255,0.7)' : C.gold }} />}
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop:10, fontSize:11, color:C.muted, display:'flex', gap:14 }}>
                  <span>● 金點 = 有預約</span><span>粗體 = 今日</span>
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={cHead}>{calDay ? fmtDate(calDay)+' 預約' : '點選日期查看預約'}</div>
              <div style={cBody}>
                {!calDay && <div style={{ fontSize:13, color:C.muted }}>請點選左側日曆中的日期</div>}
                {calDay && calDayBk.length===0 && <div style={{ fontSize:13, color:C.muted }}>當日無預約紀錄</div>}
                {calDay && calDayBk.map(b => {
                  const end = addMin(b.startH, b.startM, b.durMin)
                  const cc  = b.status==='cancelled'
                  return (
                    <div key={b._id} style={{ padding:'10px 12px', background: cc ? '#FFF5F5' : 'rgba(139,158,139,0.08)', borderLeft:`3px solid ${cc ? '#E8A8A8' : C.sage}`, borderRadius:'0 8px 8px 0', marginBottom:8 }}>
                      <div style={{ fontSize:11, color: cc ? C.danger : C.sageDark, fontWeight:500, marginBottom:2 }}>
                        {fmtTime(b.startH,b.startM)} – {fmtTime(end.h,end.m)} {cc&&'（已取消）'}
                      </div>
                      <div style={{ fontSize:13 }}>{b.name} · {b.phone}</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{b.plan==='A'?'時租':'日租'} · ${b.price}{b.note?' · '+b.note:''}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ RULES ═══════════════ */}
      {tab==='rules' && (
        <div style={{ padding:'1.5rem', maxWidth:700, margin:'0 auto' }}>
          <div style={{ fontFamily:'Noto Serif TC, serif', fontSize:22, marginBottom:'0.3rem' }}>注意事項與規範</div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:'1.5rem' }}>預約完成即視同租用人同意遵守以下規則</div>
          {RULES.map((r,i) => (
            <div key={i} style={{ ...card, marginBottom:10 }}>
              <div style={{ padding:'1rem 1.4rem', display:'flex', gap:14, alignItems:'flex-start' }}>
                <div style={{ width:36, height:36, background:'#F0EDE6', borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>{r.icon}</div>
                <div>
                  <div style={{ fontSize:11, color:C.gold, fontWeight:500, marginBottom:4, letterSpacing:'0.05em' }}>規則 {i+1}</div>
                  <div style={{ fontSize:14, lineHeight:1.85, color:C.text }}>{r.text}</div>
                </div>
              </div>
            </div>
          ))}
          <div style={{ marginTop:'1.5rem', padding:'1.2rem 1.4rem', background:'#FFF8F0', border:`1px solid #E8D8C0`, borderRadius:12, fontSize:13, color:C.muted, lineHeight:1.8, textAlign:'center' }}>
            如有疑問請於預約前透過官方管道詢問，謝謝您的配合 🙏
          </div>
        </div>
      )}

      {/* ═══════════════ SPACE ═══════════════ */}
      {tab==='space' && (
        <div style={{ padding:'1.5rem', maxWidth:700, margin:'0 auto' }}>
          <div style={{ ...card, marginBottom:'1rem' }}>
            <div style={{ padding:'1.2rem 1.4rem', display:'flex', gap:12 }}>
              <div style={{ width:42, height:42, background:C.sageLight, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>📍</div>
              <div>
                <div style={{ fontWeight:500, fontSize:14, marginBottom:4 }}>嘉義市秀園新村 No.5, 2F</div>
                <div style={{ fontSize:13, color:C.muted, lineHeight:1.7 }}>環境清幽，交通便利 · 營業時間 08:00 – 21:00</div>
              </div>
            </div>
          </div>
          <div style={{ ...card, marginBottom:'1rem' }}>
            <div style={cHead}>出租方案</div>
            <div style={cBody}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {[['A 方案・時租','$150 / 1h','1小時起租，以30分為單位追加 $75'],
                  ['B 方案・日租','$800 / 8h', '每日8小時整包，適合全日服務排程']].map(([t,p,n]) => (
                  <div key={t} style={{ border:`1px solid ${C.border}`, borderRadius:10, padding:'1rem', background:'#FAFAF7' }}>
                    <div style={{ fontSize:11, fontWeight:500, color:C.sageDark, letterSpacing:'0.06em', marginBottom:4 }}>{t}</div>
                    <div style={{ fontFamily:'Noto Serif TC, serif', fontSize:20, marginBottom:6 }}>{p}</div>
                    <div style={{ fontSize:12, color:C.muted, lineHeight:1.6 }}>{n}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={card}>
            <div style={cHead}>空間設備</div>
            <div style={cBody}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
                {AMENITIES.map(a => (
                  <div key={a.name} style={{ display:'flex', gap:10, padding:'10px 12px', border:`1px solid #E8E5DF`, borderRadius:10 }}>
                    <div style={{ width:32, height:32, background:C.sageLight, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}>{a.icon}</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:500 }}>{a.name}</div>
                      <div style={{ fontSize:11, color:C.muted, lineHeight:1.5 }}>{a.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ ADMIN ═══════════════ */}
      {tab==='admin' && isAdmin && (
        <div style={{ padding:'1.5rem', maxWidth:960, margin:'0 auto' }}>
          {/* Stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:'1.2rem' }}>
            {[['今日預約', todayCount+' 筆'],['本月預約', monthCount+' 筆'],['本月收益', '$'+monthRevenue.toLocaleString()]].map(([k,v]) => (
              <div key={k} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:'1rem 1.2rem' }}>
                <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>{k}</div>
                <div style={{ fontFamily:'Noto Serif TC, serif', fontSize:24 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={card}>
            <div style={{ ...cHead, justifyContent:'space-between' }}>
              <span>所有預約紀錄（{bookings.length} 筆）</span>
            </div>
            <div style={cBody}>
              {loading && <div style={{ fontSize:13, color:C.muted }}>載入中…</div>}
              {!loading && bookings.length===0 && <div style={{ fontSize:13, color:C.muted }}>尚無預約紀錄</div>}
              {!loading && bookings.map(b => {
                const end = addMin(b.startH, b.startM, b.durMin)
                const cc  = b.status==='cancelled'
                return (
                  <div key={b._id} style={{ padding:'12px 14px', border:`1px solid #E8E5DF`, borderRadius:10, marginBottom:8, background: cc ? '#FFF8F8' : '#FAFAF7', opacity: cc ? 0.8 : 1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4, flexWrap:'wrap' }}>
                          <span style={{ fontSize:13, fontWeight:500 }}>{b.name}</span>
                          <span style={{ fontSize:11, color:C.muted }}>{b.phone}</span>
                          <span style={{ fontSize:11, background: cc ? '#FFDDD9' : '#D4DFD4', color: cc ? C.danger : C.success, borderRadius:5, padding:'1px 7px' }}>{cc?'已取消':'確認中'}</span>
                        </div>
                        <div style={{ fontSize:12, color:C.muted, lineHeight:1.7 }}>
                          {fmtDate(b.date)} · {fmtTime(b.startH,b.startM)} – {fmtTime(end.h,end.m)} · {b.plan==='A'?'時租':'日租'} · <strong style={{ color:C.text }}>${b.price}</strong>
                          {b.note && <span> · {b.note}</span>}
                        </div>
                        <div style={{ fontSize:11, color:'#B0ACA4', marginTop:2 }}>建立：{new Date(b.createdAt).toLocaleString('zh-TW')}</div>
                      </div>
                      <div style={{ display:'flex', gap:6, flexShrink:0, marginLeft:10 }}>
                        {!cc
                          ? <button style={{ ...btn('danger'), fontSize:12, padding:'5px 10px' }} onClick={() => adminSetStatus(b._id,'cancelled')}>取消</button>
                          : <button style={{ ...btn('success'), fontSize:12, padding:'5px 10px' }} onClick={() => adminSetStatus(b._id,'confirmed')}>恢復</button>
                        }
                        <button style={{ ...btn('outline'), fontSize:12, padding:'5px 10px', color:C.danger, borderColor:'#F0C0C0' }} onClick={() => adminDelete(b._id)}>刪除</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>


          <div style={card}>
            <div style={cHead}>{'🔒'} 手動封鎖時段</div>
            <div style={cBody}>
              <div style={{ fontSize:12, color:C.muted, marginBottom:'1rem', lineHeight:1.7 }}>
                封鎖後該時段在預約頁面顯示為灰色不可選，適合用於清潔維護、個人使用等情境。
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom:'1rem' }}>
                <div>
                  <div style={lbl}>選擇日期</div>
                  <input type="date" style={inp} value={blockDate} min={todayISO()} onChange={e => { setBlockDate(e.target.value); setBlockSelSlots([]) }} />
                </div>
                <div>
                  <div style={lbl}>備註原因</div>
                  <input style={inp} value={blockNote} onChange={e => setBlockNote(e.target.value)} placeholder="例：清潔維護、個人使用…" />
                </div>
              </div>
              <div style={lbl}>選擇要封鎖的時段（可多選）</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:5, marginBottom:'1rem' }}>
                {allSlots().map(sl => {
                  const isSel = blockSelSlots.includes(sl)
                  const isTaken = getTakenSlots(blockDate).has(sl)
                  return (
                    <div key={sl} onClick={() => !isTaken && setBlockSelSlots(prev => isSel ? prev.filter(s=>s!==sl) : [...prev,sl])}
                      style={{ padding:'6px 3px', border:`1px solid ${isSel ? '#C0392B' : isTaken ? '#E8E5DF' : C.border}`, borderRadius:7, textAlign:'center', fontSize:11, cursor: isTaken ? 'not-allowed' : 'pointer', background: isSel ? '#FFDDD9' : isTaken ? '#F5F3EE' : C.white, color: isSel ? '#C0392B' : isTaken ? '#C0BCB3' : C.text, transition:'all .15s' }}>
                      {sl}
                    </div>
                  )
                })}
              </div>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <button onClick={adminBlockSlots} disabled={blockLoading || blockSelSlots.length===0}
                  style={{ ...btn('danger'), opacity: blockSelSlots.length===0 ? 0.5 : 1 }}>
                  {blockLoading ? '封鎖中…' : '封鎖已選 '+blockSelSlots.length+' 個時段'}
                </button>
                {blockSelSlots.length > 0 && <button onClick={() => setBlockSelSlots([])} style={btn('outline')}>清除選擇</button>}
              </div>

              {/* Existing blocks */}
              {blockedSlots.length > 0 && (
                <div style={{ marginTop:'1.5rem' }}>
                  <div style={{ fontSize:13, fontWeight:500, marginBottom:10 }}>已封鎖的時段紀錄</div>
                  {blockedSlots.map(b => (
                    <div key={b._id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', border:`1px solid #F0C0C0`, borderRadius:10, marginBottom:8, background:'#FFF8F8' }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:500, color:C.danger, marginBottom:2 }}>{fmtDate(b.date)} · {b.slots.join('、')}</div>
                        <div style={{ fontSize:11, color:C.muted }}>{b.note} · {new Date(b.createdAt).toLocaleString('zh-TW')}</div>
                      </div>
                      <button style={{ ...btn('outline'), fontSize:12, padding:'5px 10px', color:C.success, borderColor:'#C0DCC0', flexShrink:0 }} onClick={() => adminUnblock(b._id)}>解除封鎖</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function tryLogin() {
    if (pwInput === ADMIN_PASSWORD) {
      setIsAdmin(true); setShowLogin(false); setPwInput(''); setTab('admin')
    } else setPwErr(true)
  }
}

// ── Sub-component ──────────────────────────────────────────────────────────────
function StepBtn({ children, onClick }) {
  return (
    <button onClick={onClick}
      style={{ width:32, height:32, borderRadius:'50%', border:'1px solid #D3CFC6', background:'#fff', cursor:'pointer', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit', transition:'all .2s' }}>
      {children}
    </button>
  )
}
