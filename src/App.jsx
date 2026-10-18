import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { MessageCircle, Search, Send, LogOut, UserRound, ArrowLeft, LoaderCircle, Check, CircleAlert, Leaf, Plus, X, Paperclip, Users, FileText, Download, QrCode, UserPlus, Copy, ScanLine, UserRoundX } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Html5Qrcode } from 'html5-qrcode'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
const BUCKET = 'chat-files'

function initials(name = '?') { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?' }
function friendlyError(error) {
  const message = error?.message || 'Ha ocurrido un error. Inténtalo de nuevo.'
  if (/invalid login credentials/i.test(message)) return 'Correo o contraseña incorrectos.'
  if (/user already registered/i.test(message)) return 'Ya existe una cuenta con ese correo.'
  if (/email not confirmed/i.test(message)) return 'Confirma tu correo antes de iniciar sesión.'
  if (/row-level security|permission denied/i.test(message)) return 'Supabase ha bloqueado esta acción. Revisa las políticas de seguridad y el SQL del README.'
  return message
}

export default function App() {
  const [session, setSession] = useState(null); const [authReady, setAuthReady] = useState(false)
  const [mode, setMode] = useState('login'); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [username, setUsername] = useState('')
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState(null); const [profiles, setProfiles] = useState([]); const [groups, setGroups] = useState([])
  const [activeChat, setActiveChat] = useState(null); const [messages, setMessages] = useState([]); const [query, setQuery] = useState(''); const [draft, setDraft] = useState(''); const [mobileChat, setMobileChat] = useState(false)
  const [showGroupForm, setShowGroupForm] = useState(false); const [groupName, setGroupName] = useState(''); const [groupMembers, setGroupMembers] = useState([]); const fileRef = useRef(null); const bottomRef = useRef(null)
  const [showAddContact, setShowAddContact] = useState(false); const [showMyCode, setShowMyCode] = useState(false); const [showScanner, setShowScanner] = useState(false); const [contactCode, setContactCode] = useState(''); const [contactNotice, setContactNotice] = useState('')
  const [showGroupManager, setShowGroupManager] = useState(false); const [groupMemberIds, setGroupMemberIds] = useState([]); const [membersToAdd, setMembersToAdd] = useState([]); const [groupNotice, setGroupNotice] = useState('')
  const userId = session?.user?.id

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true) })
    return () => listener.subscription.unsubscribe()
  }, [])

  const loadPeople = useCallback(async () => {
    if (!supabase || !userId) return
    const [{ data: mine, error: mineError }, { data: contactRows, error: contactsError }, { data: memberships, error: groupError }] = await Promise.all([
      supabase.from('profiles').select('id, username, contact_code').eq('id', userId).maybeSingle(),
      supabase.from('contacts').select('contact_id').eq('user_id', userId),
      supabase.from('group_members').select('group_id, groups(id, name, created_at, created_by)')
    ])
    if (mineError || contactsError || groupError) { setError(friendlyError(mineError || contactsError || groupError)); return }
    const ids = (contactRows || []).map(row => row.contact_id)
    let people = []
    if (ids.length) {
      const { data, error: peopleError } = await supabase.from('profiles').select('id, username, contact_code').in('id', ids).order('username')
      if (peopleError) { setError(friendlyError(peopleError)); return }
      people = data || []
    }
    setProfile(mine); setProfiles(people); setGroups((memberships || []).map(m => m.groups).filter(Boolean))
  }, [userId])
  useEffect(() => { loadPeople() }, [loadPeople])

  useEffect(() => {
    if (!showScanner) return
    let scanner
    let stopped = false
    const startScanner = async () => {
      try {
        scanner = new Html5Qrcode('chat-verde-qr-reader')
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async decodedText => {
            if (stopped) return
            setContactCode(decodedText.trim())
            setShowScanner(false)
            try { if (scanner?.isScanning) await scanner.stop() } catch {}
          },
          () => {}
        )
      } catch {
        setContactNotice('No se pudo abrir la cámara. Revisa los permisos del navegador o introduce el código manualmente.')
      }
    }
    startScanner()
    return () => {
      stopped = true
      if (scanner?.isScanning) scanner.stop().then(() => scanner.clear()).catch(() => {})
    }
  }, [showScanner])

  const loadMessages = useCallback(async (chat) => {
    if (!supabase || !userId || !chat) return
    let request = supabase.from('messages').select('id, sender_id, recipient_id, group_id, body, file_path, file_name, file_type, created_at')
    if (chat.type === 'group') request = request.eq('group_id', chat.id)
    else request = request.is('group_id', null).or(`and(sender_id.eq.${userId},recipient_id.eq.${chat.id}),and(sender_id.eq.${chat.id},recipient_id.eq.${userId})`)
    const { data, error: loadError } = await request.order('created_at', { ascending: true }).limit(500)
    if (loadError) { setError(friendlyError(loadError)); return }
    const withUrls = await Promise.all((data || []).map(async m => {
      if (!m.file_path) return m
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(m.file_path, 3600)
      return { ...m, file_url: signed?.signedUrl || null }
    }))
    setMessages(withUrls)
  }, [userId])

  useEffect(() => {
    if (!activeChat || !userId || !supabase) return
    loadMessages(activeChat)
    const channel = supabase.channel(`messages-${activeChat.type}-${activeChat.id}-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async payload => {
        const msg = payload.new
        const relevant = activeChat.type === 'group' ? msg.group_id === activeChat.id : !msg.group_id && ((msg.sender_id === userId && msg.recipient_id === activeChat.id) || (msg.sender_id === activeChat.id && msg.recipient_id === userId))
        if (!relevant) return
        let next = msg
        if (msg.file_path) { const { data } = await supabase.storage.from(BUCKET).createSignedUrl(msg.file_path, 3600); next = { ...msg, file_url: data?.signedUrl || null } }
        setMessages(current => current.some(m => m.id === next.id) ? current : [...current, next].sort((a,b) => new Date(a.created_at)-new Date(b.created_at)))
      }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeChat, userId, loadMessages])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, activeChat])

  const filteredProfiles = useMemo(() => profiles.filter(p => (p.username || '').toLowerCase().includes(query.trim().toLowerCase())), [profiles, query])
  const filteredGroups = useMemo(() => groups.filter(g => (g.name || '').toLowerCase().includes(query.trim().toLowerCase())), [groups, query])

  async function handleAuth(event) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true)
    try {
      if (!supabase) throw new Error('Falta configurar .env.local con los datos de Supabase.')
      if (mode === 'register') {
        const cleanName = username.trim().replace(/\s+/g, ' ')
        if (cleanName.length < 3 || cleanName.length > 24) throw new Error('El nombre debe tener entre 3 y 24 caracteres.')
        const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { username: cleanName } } })
        if (e) throw e
        setNotice(data.session ? '¡Cuenta creada! Ya puedes empezar a hablar.' : 'Cuenta creada. Revisa tu correo para confirmar el registro y luego inicia sesión.')
      } else { const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (e) throw e }
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  async function addContact(event) {
    event?.preventDefault()
    setError('')
    setContactNotice('')
    const code = contactCode.trim().toUpperCase()
    if (!code) { setContactNotice('Introduce el código de la otra persona o escanea su QR.'); return }
    setBusy(true)
    try {
      const { data, error: addError } = await supabase.rpc('add_contact_by_code', { p_code: code })
      if (addError) throw addError
      const added = Array.isArray(data) ? data[0] : data
      await loadPeople()
      setContactCode('')
      setShowScanner(false)
      setContactNotice(added?.username ? `¡${added.username} se ha añadido a tus contactos!` : 'Contacto añadido correctamente.')
      setShowAddContact(false)
    } catch (e) {
      const msg = e?.message || ''
      if (/not found|no existe|invalid contact code/i.test(msg)) setContactNotice('No encontramos ese código. Comprueba que esté escrito correctamente.')
      else if (/yourself|your own|ti mismo/i.test(msg)) setContactNotice('Ese es tu propio código. Introduce el código de otra persona.')
      else setContactNotice(friendlyError(e))
    } finally { setBusy(false) }
  }

  async function copyMyCode() {
    if (!profile?.contact_code) return
    try { await navigator.clipboard.writeText(profile.contact_code); setContactNotice('Código copiado.') }
    catch { setContactNotice(`Tu código es ${profile.contact_code}`) }
  }

  async function sendPayload({ body = '', file = null } = {}) {
    if (!activeChat || !supabase || busy || (!body.trim() && !file)) return
    setBusy(true); setError('')
    try {
      let fileData = {}
      if (file) {
        if (file.size > 10 * 1024 * 1024) throw new Error('El archivo supera el límite de 10 MB.')
        const folder = activeChat.type === 'group' ? `group_${activeChat.id}` : `dm_${[userId, activeChat.id].sort().join('_')}`
        const safeName = file.name.replace(/[^\w.() -]/g, '_').slice(-120)
        const path = `${folder}/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
        if (uploadError) throw uploadError
        fileData = { file_path: path, file_name: file.name, file_type: file.type || 'application/octet-stream' }
      }
      const payload = { sender_id: userId, recipient_id: activeChat.type === 'user' ? activeChat.id : null, group_id: activeChat.type === 'group' ? activeChat.id : null, body: body.trim() || null, ...fileData }
      const { data, error: sendError } = await supabase.from('messages').insert(payload).select('id, sender_id, recipient_id, group_id, body, file_path, file_name, file_type, created_at').single()
      if (sendError) throw sendError
      let msg = data
      if (data.file_path) { const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(data.file_path, 3600); msg = { ...data, file_url: signed?.signedUrl || null } }
      setMessages(current => current.some(m => m.id === msg.id) ? current : [...current, msg].sort((a,b) => new Date(a.created_at)-new Date(b.created_at)))
      setDraft('')
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  async function sendMessage(e) { e.preventDefault(); if (draft.trim().length > 4000) { setError('El mensaje no puede superar 4000 caracteres.'); return }; await sendPayload({ body: draft }) }
  async function sendFile(e) { const file = e.target.files?.[0]; e.target.value = ''; if (file) await sendPayload({ file }) }

  async function removeContact() {
    if (!activeChat || activeChat.type !== 'user') return
    if (!window.confirm(`¿Quieres eliminar a ${activeChat.username} de tus contactos?`)) return
    setBusy(true); setError('')
    try {
      const { error: removeError } = await supabase.from('contacts').delete().eq('user_id', userId).eq('contact_id', activeChat.id)
      if (removeError) throw removeError
      setActiveChat(null); setMessages([]); setMobileChat(false)
      await loadPeople()
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  async function leaveGroup() {
    if (!activeChat || activeChat.type !== 'group') return
    if (!window.confirm(`¿Quieres salir del grupo «${activeChat.name}»? El grupo seguirá existiendo para los demás.`)) return
    setBusy(true); setError('')
    try {
      const { error: leaveError } = await supabase.from('group_members').delete().eq('group_id', activeChat.id).eq('user_id', userId)
      if (leaveError) throw leaveError
      setActiveChat(null); setMessages([]); setMobileChat(false); setShowGroupManager(false)
      await loadPeople()
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  async function openGroupManager() {
    if (!activeChat || activeChat.type !== 'group') return
    setError(''); setGroupNotice(''); setMembersToAdd([]); setBusy(true)
    try {
      const { data, error: membersError } = await supabase.from('group_members').select('user_id').eq('group_id', activeChat.id)
      if (membersError) throw membersError
      setGroupMemberIds((data || []).map(row => row.user_id))
      setShowGroupManager(true)
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  async function addMembersToGroup(e) {
    e.preventDefault()
    if (!activeChat || activeChat.type !== 'group' || !membersToAdd.length) return
    setBusy(true); setError(''); setGroupNotice('')
    try {
      const newIds = [...new Set(membersToAdd)].filter(id => !groupMemberIds.includes(id))
      if (!newIds.length) { setGroupNotice('Todas las personas seleccionadas ya están en el grupo.'); return }
      const rows = newIds.map(user_id => ({ group_id: activeChat.id, user_id }))
      const { error: insertError } = await supabase.from('group_members').insert(rows)
      if (insertError) throw insertError
      setGroupMemberIds(old => [...new Set([...old, ...newIds])])
      setMembersToAdd([])
      setGroupNotice(`Se ${newIds.length === 1 ? 'ha añadido 1 persona' : `han añadido ${newIds.length} personas`} al grupo.`)
      await loadPeople()
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  async function createGroup(e) {
    e.preventDefault(); setError('')
    const clean = groupName.trim()
    if (clean.length < 2) { setError('El grupo necesita un nombre de al menos 2 caracteres.'); return }
    if (!groupMembers.length) { setError('Selecciona al menos a una persona para el grupo.'); return }
    setBusy(true)
    try {
      const { data: group, error: createError } = await supabase.from('groups').insert({ name: clean, created_by: userId }).select('id, name, created_at, created_by').single()
      if (createError) throw createError
      const memberRows = [...new Set([userId, ...groupMembers])].map(user_id => ({ group_id: group.id, user_id }))
      const { error: memberError } = await supabase.from('group_members').insert(memberRows)
      if (memberError) throw memberError
      setGroups(old => [...old, group]); setActiveChat({ type: 'group', id: group.id, name: group.name }); setMessages([]); setMobileChat(true); setShowGroupForm(false); setGroupName(''); setGroupMembers([])
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  async function signOut() { if (!supabase) return; await supabase.auth.signOut(); setActiveChat(null); setMessages([]); setMobileChat(false) }
  function openPerson(person) { setActiveChat({ type: 'user', id: person.id, username: person.username }); setMessages([]); setMobileChat(true); setError('') }
  function openGroup(group) { setActiveChat({ type: 'group', id: group.id, name: group.name }); setMessages([]); setMobileChat(true); setError('') }

  if (!supabase) return <main className="setup-screen"><div className="setup-card"><div className="brand-mark"><Leaf size={26}/></div><h1>Conecta Chat Verde</h1><p>Crea <code>.env.local</code> en la carpeta principal y añade los datos de tu proyecto Supabase.</p><pre>VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co{ '\n' }VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA</pre><p className="muted">Guarda el archivo y reinicia con <code>npm run dev</code>.</p></div></main>
  if (!authReady) return <main className="loading-screen"><LoaderCircle className="spin"/><span>Preparando tu chat…</span></main>
  if (!session) return <main className="auth-screen"><div className="auth-decoration decoration-one"/><div className="auth-decoration decoration-two"/><section className="auth-card"><div className="brand-mark"><Leaf size={27}/></div><p className="eyebrow">UN LUGAR PARA CONECTAR</p><h1>{mode === 'login' ? 'Qué bueno verte.' : 'Empieza una conversación.'}</h1><p className="auth-subtitle">{mode === 'login' ? 'Entra y ponte al día con tu gente.' : 'Crea tu cuenta y encuentra a tus personas.'}</p><div className="auth-tabs"><button className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError(''); setNotice('') }}>Iniciar sesión</button><button className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError(''); setNotice('') }}>Crear cuenta</button></div><form onSubmit={handleAuth} className="auth-form">{mode === 'register' && <label>Nombre de usuario<input autoComplete="nickname" value={username} onChange={e => setUsername(e.target.value)} placeholder="Cómo te llamas" minLength={3} maxLength={24} required/></label>}<label>Correo electrónico<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" required/></label><label>Contraseña<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" minLength={6} required/></label>{error && <div className="alert error"><CircleAlert size={17}/>{error}</div>}{notice && <div className="alert success"><Check size={17}/>{notice}</div>}<button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : null}{mode === 'login' ? 'Entrar a mi chat' : 'Crear mi cuenta'}<span>→</span></button></form><p className="privacy-note">Tus datos se gestionan mediante Supabase.</p></section><div className="auth-footer"><Leaf size={15}/> Chat Verde <span>·</span> conversaciones que acercan</div></main>

  const activeName = activeChat?.type === 'group' ? activeChat.name : activeChat?.username
  return <main className="app-shell"><aside className={`sidebar ${mobileChat ? 'hide-mobile' : ''}`}><header className="side-header"><div className="brand-lockup"><div className="brand-mark small"><Leaf size={21}/></div><div><strong>chat verde</strong><span>tu espacio, tu gente</span></div></div><button className="icon-button" title="Mi código QR" onClick={() => { setContactNotice(''); setShowMyCode(true) }}><QrCode size={19}/></button><button className="icon-button" title="Añadir contacto" onClick={() => { setContactNotice(''); setContactCode(''); setShowScanner(false); setShowAddContact(true) }}><UserPlus size={19}/></button></header><div className="my-profile"><div className="avatar own"><UserRound size={21}/></div><div className="profile-copy"><strong>{profile?.username || session.user.email?.split('@')[0] || 'Mi cuenta'}</strong><span>Conectado</span></div><button className="icon-button logout" title="Cerrar sesión" onClick={signOut}><LogOut size={18}/></button></div><div className="list-heading"><div><span>CONTACTOS Y GRUPOS</span><span className="count-pill">{profiles.length + groups.length}</span></div><button className="icon-button subtle" title="Crear grupo" onClick={() => { setShowGroupForm(true); setError('') }}><Plus size={18}/></button></div><div className="search-box"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar contactos o grupos…" aria-label="Buscar contactos o grupos"/><button className="clear-search" onClick={() => setQuery('')} title="Limpiar búsqueda">{query && <X size={15}/>}</button></div><div className="people-list">{filteredGroups.map(group => <button key={`g-${group.id}`} className={`person-row ${activeChat?.type === 'group' && activeChat.id === group.id ? 'active' : ''}`} onClick={() => openGroup(group)}><div className="avatar group-avatar"><Users size={19}/></div><div className="person-copy"><strong>{group.name}</strong><span>Grupo</span></div><MessageCircle size={17} className="row-chat-icon"/></button>)}{filteredProfiles.map(person => <button key={person.id} className={`person-row ${activeChat?.type === 'user' && activeChat.id === person.id ? 'active' : ''}`} onClick={() => openPerson(person)}><div className="avatar">{initials(person.username)}</div><div className="person-copy"><strong>{person.username}</strong><span>Chat privado</span></div><MessageCircle size={17} className="row-chat-icon"/></button>)}{filteredProfiles.length + filteredGroups.length === 0 && <div className="empty-people"><div className="empty-icon"><UserRound size={22}/></div><strong>No hay coincidencias</strong><p>Añade un contacto con su código o crea un grupo.</p></div>}</div><footer className="sidebar-footer"><span className="online-dot"/> Tus conversaciones, en un solo lugar <button onClick={signOut}>Salir</button></footer></aside>
  <section className={`chat-panel ${mobileChat ? 'show-mobile' : ''}`}>{activeChat ? <><header className="chat-header"><button className="icon-button back-button" onClick={() => setMobileChat(false)} title="Volver a contactos"><ArrowLeft size={20}/></button><div className={`avatar ${activeChat.type === 'group' ? 'group-avatar' : ''}`}>{activeChat.type === 'group' ? <Users size={19}/> : initials(activeName)}</div><div className="chat-title"><strong>{activeName}</strong><span><i className="online-dot"/> {activeChat.type === 'group' ? 'Chat de grupo' : 'Chat privado'}</span></div>{activeChat.type === 'group' ? <><button className="icon-button" onClick={openGroupManager} title="Añadir personas al grupo" aria-label="Añadir personas al grupo"><UserPlus size={19}/></button><button className="icon-button" onClick={leaveGroup} title="Salir del grupo" aria-label="Salir del grupo"><LogOut size={18}/></button></> : <button className="icon-button" onClick={removeContact} title="Eliminar contacto" aria-label="Eliminar contacto"><UserRoundX size={19}/></button>}<div className="header-leaf"><Leaf size={21}/></div></header><div className="message-area"><div className="conversation-intro"><div className="intro-avatar">{activeChat.type === 'group' ? <Users size={22}/> : initials(activeName)}</div><strong>{activeName}</strong><span>{activeChat.type === 'group' ? 'Conversación en grupo.' : 'Esta es vuestra conversación.'}</span><small>Los mensajes y archivos se guardan en Supabase.</small></div>{messages.map(message => { const mine = message.sender_id === userId; return <div className={`message-line ${mine ? 'mine' : 'theirs'}`} key={message.id}><div className="message-bubble">{activeChat.type === 'group' && !mine && <small className="sender-name">{profiles.find(p => p.id === message.sender_id)?.username || 'Participante'}</small>}{message.body && <p>{message.body}</p>}{message.file_path && <div className="attachment">{message.file_type?.startsWith('image/') && message.file_url ? <a href={message.file_url} target="_blank" rel="noreferrer"><img className="attachment-image" src={message.file_url} alt={message.file_name || 'Imagen adjunta'}/></a> : <FileText size={23}/>}<div className="attachment-meta"><strong>{message.file_name || 'Archivo adjunto'}</strong><span>Archivo adjunto</span></div>{message.file_url && <a className="download-link" href={message.file_url} target="_blank" rel="noreferrer" title="Abrir o descargar"><Download size={17}/></a>}</div>}<time>{new Date(message.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}{mine && <Check size={13}/>}</time></div></div> })}<div ref={bottomRef}/></div>{error && <div className="chat-error"><CircleAlert size={16}/>{error}<button onClick={() => setError('')}>Cerrar</button></div>}<form className="composer" onSubmit={sendMessage}><input value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Escribe en ${activeName}…`} aria-label="Escribir mensaje" maxLength={4000}/><span className="char-count">{draft.length > 3500 ? `${draft.length}/4000` : ''}</span><input ref={fileRef} className="hidden-file" type="file" onChange={sendFile}/><button type="button" className="attach-button" onClick={() => fileRef.current?.click()} title="Adjuntar archivo" aria-label="Adjuntar archivo"><Paperclip size={19}/></button><button className="send-button" disabled={!draft.trim() || busy} aria-label="Enviar mensaje">{busy ? <LoaderCircle className="spin" size={19}/> : <Send size={19}/>}</button></form><div className="composer-caption">Archivos de hasta 10 MB · imágenes y documentos</div></> : <div className="welcome-panel"><div className="welcome-art"><div className="art-circle circle-a"/><div className="art-circle circle-b"/><div className="art-chat"><MessageCircle size={47}/><span>✦</span></div><div className="floating-leaf leaf-a"><Leaf size={22}/></div><div className="floating-leaf leaf-b"><Leaf size={18}/></div></div><p className="eyebrow">UN RESPIRO EN TU DÍA</p><h1>Las buenas conversaciones<br/>empiezan con un hola.</h1><p>Añade contactos con su QR o código, o crea un grupo.</p><button className="primary-button welcome-create" onClick={() => setShowGroupForm(true)}><Users size={17}/> Crear un grupo</button></div>}</section>
  {showGroupForm && <div className="modal-backdrop" role="presentation"><section className="group-modal" role="dialog" aria-modal="true" aria-labelledby="group-title"><header><div><div className="modal-icon"><Users size={21}/></div><h2 id="group-title">Crear un grupo</h2><p>Elige un nombre y a quién quieres añadir de tus contactos.</p></div><button className="icon-button" onClick={() => setShowGroupForm(false)} aria-label="Cerrar"><X size={20}/></button></header><form onSubmit={createGroup}><label>Nombre del grupo<input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Ej. Amigos" maxLength={60} required/></label><div className="member-picker-label">Participantes <span>{groupMembers.length} seleccionados</span></div><div className="member-picker">{profiles.map(p => <label key={p.id} className="member-option"><input type="checkbox" checked={groupMembers.includes(p.id)} onChange={e => setGroupMembers(old => e.target.checked ? [...old, p.id] : old.filter(id => id !== p.id))}/><span className="avatar">{initials(p.username)}</span><span>{p.username}</span></label>)}{profiles.length === 0 && <p className="muted">Todavía no has añadido contactos. Usa el botón de añadir contacto.</p>}</div>{error && <div className="alert error"><CircleAlert size={16}/>{error}</div>}<button className="primary-button" disabled={busy || !groupName.trim() || !groupMembers.length}>{busy ? <LoaderCircle className="spin" size={18}/> : <Users size={18}/>} Crear grupo</button></form></section></div>}

  {showGroupManager && activeChat?.type === 'group' && <div className="modal-backdrop" role="presentation"><section className="group-modal" role="dialog" aria-modal="true" aria-labelledby="manage-group-title"><header><div><div className="modal-icon"><UserPlus size={21}/></div><h2 id="manage-group-title">Añadir personas</h2><p>Selecciona contactos para incorporarlos a «{activeChat.name}».</p></div><button className="icon-button" onClick={() => setShowGroupManager(false)} aria-label="Cerrar"><X size={20}/></button></header><form onSubmit={addMembersToGroup}><div className="member-picker-label">Contactos disponibles <span>{membersToAdd.length} seleccionados</span></div><div className="member-picker">{profiles.filter(p => !groupMemberIds.includes(p.id)).map(p => <label key={p.id} className="member-option"><input type="checkbox" checked={membersToAdd.includes(p.id)} onChange={e => setMembersToAdd(old => e.target.checked ? [...old, p.id] : old.filter(id => id !== p.id))}/><span className="avatar">{initials(p.username)}</span><span>{p.username}</span></label>)}{profiles.filter(p => !groupMemberIds.includes(p.id)).length === 0 && <p className="muted">Todos tus contactos ya forman parte de este grupo.</p>}</div>{groupNotice && <div className="alert success"><Check size={16}/>{groupNotice}</div>}{error && <div className="alert error"><CircleAlert size={16}/>{error}</div>}<button className="primary-button" disabled={busy || !membersToAdd.length} style={{marginTop:12}}>{busy ? <LoaderCircle className="spin" size={18}/> : <UserPlus size={18}/>} Añadir al grupo</button></form></section></div>}

  {showMyCode && <div className="modal-backdrop" role="presentation"><section className="group-modal contact-modal" role="dialog" aria-modal="true" aria-labelledby="my-code-title"><header><div><div className="modal-icon"><QrCode size={21}/></div><h2 id="my-code-title">Mi código de Chat Verde</h2><p>Comparte este QR o código para que otras personas te añadan.</p></div><button className="icon-button" onClick={() => setShowMyCode(false)} aria-label="Cerrar"><X size={20}/></button></header><div style={{display:'grid',justifyItems:'center',gap:16,padding:'12px 0'}}>{profile?.contact_code ? <QRCodeSVG value={profile.contact_code} size={200} level="M" includeMargin /> : <p>Generando tu código…</p>}<strong style={{fontSize:22,letterSpacing:2}}>{profile?.contact_code || '—'}</strong><button type="button" className="primary-button" onClick={copyMyCode}><Copy size={17}/> Copiar mi código</button>{contactNotice && <p className="muted">{contactNotice}</p>}</div></section></div>}
  {showAddContact && <div className="modal-backdrop" role="presentation"><section className="group-modal contact-modal" role="dialog" aria-modal="true" aria-labelledby="add-contact-title"><header><div><div className="modal-icon"><UserPlus size={21}/></div><h2 id="add-contact-title">Añadir contacto</h2><p>Escanea el QR de alguien o introduce su código único.</p></div><button className="icon-button" onClick={() => { setShowAddContact(false); setShowScanner(false) }} aria-label="Cerrar"><X size={20}/></button></header><form onSubmit={addContact}><label>Código de contacto<input value={contactCode} onChange={e => setContactCode(e.target.value.toUpperCase())} placeholder="Ej. CV-A1B2C3D4" autoCapitalize="characters" maxLength={24} /></label><button type="button" className="primary-button" onClick={() => { setContactNotice(''); setShowScanner(v => !v) }}><ScanLine size={17}/>{showScanner ? 'Cerrar escáner' : 'Escanear código QR'}</button>{showScanner && <div id="chat-verde-qr-reader" style={{width:'100%',marginTop:14}}/>}{contactNotice && <div className="alert success" style={{marginTop:12}}><Check size={16}/>{contactNotice}</div>}{error && <div className="alert error" style={{marginTop:12}}><CircleAlert size={16}/>{error}</div>}<button className="primary-button" disabled={busy || !contactCode.trim()} style={{marginTop:12}}>{busy ? <LoaderCircle className="spin" size={18}/> : <UserPlus size={18}/>} Añadir a mis contactos</button></form></section></div>}
  </main>
}
