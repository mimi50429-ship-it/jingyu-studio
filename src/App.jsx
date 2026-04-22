import React, { useState, useEffect } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  query, orderBy, onSnapshot
} from 'firebase/firestore'
import { 
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, 
  onAuthStateChanged, signOut 
} from 'firebase/auth'
import { db } from './firebase'

// ─── Constants ────────────────────────────────────────────────────────────────
const ADMIN_EMAIL = 'admin@jingyu.com' // 您可以用這個信箱當管理員
const ADMIN_PASSWORD = 'jingyu2025'
const OPEN_H = 8, CLOSE_H = 21
const MONTHS_TW = ['一','二','三','四','五','六','七','八','九','十','十一','十二']
const DAYS_TW   = ['日','一','二','三','四','五','六']

const RULES = [
  { icon: '🔑', text: '付款完成後，預約時段開始前 24 小時告知鑰匙位置。' },
  { icon: '⏱',  text: '請遵守時間，超時每分鐘收費 $10 元。' },
  { icon: '🚭', text: '全面禁止吸菸、飲酒、嚼食檳榔。' },
  { icon: '👥', text: '租用時段最多 3 人在場，禁止攜帶寵物。' },
  { icon: '📋', text: '預約完成視同同意遵守本使用規則。' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad    = n => (n < 10 ? '0' : '') + n
const fmtDate = d => { if (!d) return '—'; const [y,m,day]=d.split('-'); return `${y}年${+m}月${+day}日` }
const fmtTime = (h,m) => pad(h)+':'+pad(m)
const addMin  = (h,m,mins) => { const t=h*60+m+mins; return {h:Math.floor(t/60),m:t%60} }
const todayISO = () => new Date().toISOString().split('T')[0]

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const auth = getAuth()
  const [user, setUser] = useState(null) // 登入的會員資料
  const [tab, setTab] = useState('booking')
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)

  // Auth States
  const [authEmail, setAuthEmail] = useState('')
  const [authPw, setAuthPw] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  // Admin States
  const [isAdmin, setIsAdmin] = useState(false)
  const [blockedSlots, setBlockedSlots] = useState([])
  const [blockDate, setBlockDate] = useState(todayISO())
  const [blockSelSlots, setBlockSelSlots] = useState([])
  const [blockNote, setBlockNote] = useState('')

  // Booking form
  const [plan, setPlan] = useState('A')
  const [hours, setHours] = useState(2)
  const [days, setDays] = useState(1)
  const [extraHalf, setExtraHalf] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [slot, setSlot] = useState(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 監聽登入狀態
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setIsAdmin(u && u.email === ADMIN_EMAIL)
    })
  }, [])

  // 監聽預約與封鎖時段
  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'))
    const unsub1 = onSnapshot(q, snap => setBookings(snap.docs.map(d => ({ ...d.data(), _id: d.id }))))
    const q2 = query(collection(db, 'blocked_slots'), orderBy('createdAt', 'desc'))
    const unsub2 = onSnapshot(q2, snap => setBlockedSlots(snap.docs.map(d => ({ ...d.data(), _id: d.id }))))
    setLoading(false)
    return () => { unsub1(); unsub2() }
  }, [])

  // ── 會員價格與時數邏輯 ──
  // 會員價：時租 A 方案 $100/h，起租 1 小時。非會員：$150/h，起租 2 小時。
  const isMember = !!user
  const hourlyRate = isMember ? 100 : 150
  const minHours = isMember ? 1 : 2
  
  useEffect(() => {
    if (hours < minHours) setHours(minHours)
  }, [user, minHours])

  const calcPrice = () => plan === 'B' ? 800 * days : (hourlyRate * hours) + (extraHalf ? (hourlyRate/2) : 0)
  const calcDurMin = () => plan === 'B' ? days * 8 * 60 : hours * 60 + (extraHalf ? 30 : 0)

  // ── Auth Actions ──
  async function handleAuth() {
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, authEmail, authPw)
        showToast('註冊成功並已登入！')
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPw)
        showToast('登入成功！')
      }
      setShowAuthModal(false)
      setAuthEmail(''); setAuthPw('')
    } catch (e) {
      showToast('認證失敗：' + e.message, 'err')
    }
  }

  function showToast(msg, type = 'ok') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  // ── 預約邏輯 (同前，略作整合) ──
  function getTakenSlots(d) {
    const s = new Set()
    bookings.filter(b => b.date === d && b.status !== 'cancelled').forEach(b => {
      let cur = b.startH * 60 + b.startM
      for (let i = 0; i < b.durMin; i += 30) { s.add(fmtTime(Math.floor(cur/60), cur%60)); cur += 30 }
    })
    blockedSlots.filter(b => b.date === d).forEach(b => b.slots.forEach(sl => s.add(sl)))
    return s
  }

  async function submitBooking() {
    if (!name.trim() || !phone.trim() || !slot || !agreed) { showToast('請填寫完整資訊並同意規則', 'err'); return }
    setSubmitting(true)
    const [sh, sm] = slot.split(':').map(Number)
    try {
      await addDoc(collection(db, 'bookings'), {
        plan, date, startH: sh, startM: sm, durMin: calcDurMin(),
        price: calcPrice(), name, phone, note, status: 'confirmed',
        userEmail: user?.email || 'guest', createdAt: new Date().toISOString()
      })
      showToast('✓ 預約成功！')
      setSlot(null); setName(''); setPhone(''); setAgreed(false)
    } catch (e) { showToast('儲存失敗', 'err') }
    finally { setSubmitting(false) }
  }

  // ── 管理員封鎖時段 ──
  async function adminBlockSlots() {
    try {
      await addDoc(collection(db, 'blocked_slots'), {
        date: blockDate, slots: blockSelSlots, note: blockNote || '管理員封鎖', createdAt: new Date().toISOString()
      })
      showToast('已封鎖時段'); setBlockSelSlots([])
    } catch (e) { showToast('封鎖失敗', 'err') }
  }

  // ── Styles ──
  const C = { sage:'#8B9E8B', sageDark:'#5C7060', cream:'#F7F4EE', border:'#D3CFC6', text:'#2C2C2A', white:'#fff', danger:'#C0392B' }
  const btn = (v) => ({
    padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
    background: v === 'primary' ? C.sage : C.white, color: v === 'primary' ? '#fff' : C.text,
    border: v === 'outline' ? `1px solid ${C.border}` : 'none'
  })

  return (
    <div style={{ fontFamily: 'sans-serif', minHeight: '100vh', background: C.cream, color: C.text }}>
      {/* Header */}
      <div style={{ background: C.white, padding: '1rem', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <b style={{ fontSize: 18 }}>京雨美學坊</b>
          {user && <div style={{ fontSize: 11, color: C.sageDark }}>歡迎會員：{user.email} {isMember && '(享特惠價)'}</div>}
        </div>
        <div>
          {user ? (
            <button style={btn('outline')} onClick={() => signOut(auth)}>登出</button>
          ) : (
            <button style={btn('primary')} onClick={() => setShowAuthModal(true)}>會員登入 / 註冊</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: C.white, borderBottom: `1px solid ${C.border}` }}>
        {['booking', 'rules', 'admin'].map(t => (
          (t !== 'admin' || isAdmin) && (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '12px', border: 'none', background: 'none', borderBottom: tab === t ? `2px solid ${C.sage}` : 'none' }}>
              {t === 'booking' ? '預約租用' : t === 'rules' ? '規則' : '管理後台'}
            </button>
          )
        ))}
      </div>

      {/* Toast */}
      {toast && <div style={{ position:'fixed', top: 20, left:'50%', transform:'translateX(-50%)', background: C.text, color:'#fff', padding:'10px 20px', borderRadius:8, zIndex:100 }}>{toast.msg}</div>}

      {/* Auth Modal */}
      {showAuthModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div style={{ background:'#fff', padding:'2rem', borderRadius:12, width:300 }}>
            <h3>{isSignUp ? '會員註冊' : '會員登入'}</h3>
            <input style={{ width:'100%', padding:8, marginBottom:10 }} placeholder="Email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} />
            <input style={{ width:'100%', padding:8, marginBottom:10 }} type="password" placeholder="密碼" value={authPw} onChange={e=>setAuthPw(e.target.value)} />
            <button style={{ ...btn('primary'), width:'100%' }} onClick={handleAuth}>{isSignUp ? '註冊' : '登入'}</button>
            <p style={{ fontSize:12, textAlign:'center', cursor:'pointer', marginTop:10 }} onClick={()=>setIsSignUp(!isSignUp)}>
              {isSignUp ? '已有帳號？去登入' : '沒有帳號？去註冊'}
            </p>
            <button style={{ ...btn('outline'), width:'100%', marginTop:5 }} onClick={()=>setShowAuthModal(false)}>取消</button>
          </div>
        </div>
      )}

      {/* Booking Page */}
      {tab === 'booking' && (
        <div style={{ padding: '1rem', maxWidth: 600, margin: 'auto' }}>
          <div style={{ background: '#fff', padding: '1rem', borderRadius: 12, border: `1px solid ${C.border}` }}>
            <h4>選擇方案 {isMember && <span style={{ color: C.sage }}> (會員優惠中)</span>}</h4>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPlan('A')} style={{ ...btn(plan === 'A' ? 'primary' : 'outline'), flex: 1 }}>
                時租 ($ {hourlyRate}/h)
              </button>
              <button onClick={() => setPlan('B')} style={{ ...btn(plan === 'B' ? 'primary' : 'outline'), flex: 1 }}>
                日租 ($ 800/8h)
              </button>
            </div>

            {plan === 'A' && (
              <div style={{ marginTop: 15 }}>
                <label>時數 (會員 1h 起，訪客 2h 起): </label>
                <input type="number" min={minHours} value={hours} onChange={e => setHours(Number(e.target.value))} style={{ width: 50 }} />
                <label> <input type="checkbox" checked={extraHalf} onChange={e => setExtraHalf(e.target.checked)} /> +30分 </label>
              </div>
            )}

            <div style={{ marginTop: 15 }}>
              <label>日期: </label>
              <input type="date" value={date} min={todayISO()} onChange={e => setDate(e.target.value)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginTop: 15 }}>
              {Array.from({ length: 26 }).map((_, i) => {
                const h = 8 + Math.floor(i / 2), m = (i % 2) * 30
                const t = fmtTime(h, m)
                const taken = getTakenSlots(date).has(t)
                return (
                  <button key={t} disabled={taken} onClick={() => setSlot(t)} style={{ 
                    padding: 5, fontSize: 11, background: slot === t ? C.sage : taken ? '#eee' : '#fff',
                    color: slot === t ? '#fff' : taken ? '#ccc' : C.text
                  }}>{t}</button>
                )
              })}
            </div>

            <input style={{ width: '100%', marginTop: 15, padding: 8 }} placeholder="姓名" value={name} onChange={e => setName(e.target.value)} />
            <input style={{ width: '100%', marginTop: 10, padding: 8 }} placeholder="電話" value={phone} onChange={e => setPhone(e.target.value)} />
            
            <div style={{ marginTop: 15, fontSize: 12 }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} /> 我同意使用規則
            </div>

            <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
              <b>合計金額: ${calcPrice()}</b>
              <button disabled={submitting} onClick={submitBooking} style={{ ...btn('primary'), width: '100%', marginTop: 10 }}>
                {submitting ? '處理中...' : '確認預約'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Page */}
      {tab === 'admin' && isAdmin && (
        <div style={{ padding: '1rem' }}>
          <h3>管理後台</h3>
          <div style={{ background: '#fff', padding: '1rem', borderRadius: 12, marginBottom: 20 }}>
            <h4>🔒 封鎖時段</h4>
            <input type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)} />
            <input placeholder="備註" value={blockNote} onChange={e => setBlockNote(e.target.value)} style={{ marginLeft: 10 }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
              {['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'].map(s => (
                <button key={s} onClick={() => setBlockSelSlots(prev => prev.includes(s) ? prev.filter(x=>x!==s) : [...prev, s])}
                  style={{ background: blockSelSlots.includes(s) ? C.danger : '#fff' }}>{s}</button>
              ))}
            </div>
            <button onClick={adminBlockSlots} style={{ ...btn('primary'), marginTop: 10 }}>確認封鎖</button>
          </div>

          <h4>預約列表</h4>
          {bookings.map(b => (
            <div key={b._id} style={{ background:'#fff', padding:10, marginBottom:5, borderRadius:8, fontSize:13 }}>
              {b.date} {pad(b.startH)}:{pad(b.startM)} - {b.name} ({b.phone}) - ${b.price} 
              <button onClick={() => adminDelete(b._id)} style={{ color: C.danger, marginLeft: 10 }}>刪除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
