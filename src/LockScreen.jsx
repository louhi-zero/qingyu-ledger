/* v3.4 应用锁解锁页：数字密码（键盘）+ 手势密码（九宫格连线）
 *
 * 输入控件复用 ui/lockinput.jsx（与设置页共用同一套，避免两处实现分叉）。
 * 手势用 pointer 事件，触屏与鼠标（桌面 Electron）都能解锁。
 * 「忘记密码」不做后门——任何前端后门都等于没有锁，只给出数据处置说明。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { PinPad, PinDots, PatternPad } from './ui/lockinput.jsx'
import { isValidPin } from './applock.js'

export default function LockScreen({ lock }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const [forgot, setForgot] = useState(false)

  const expect = lock.len || 4

  const fail = useCallback((msg) => {
    if (msg) lock.setError?.(msg)
    setShake((n) => n + 1)
    setPin('')
  }, [lock])

  const submit = useCallback(async (code) => {
    if (busy) return
    setBusy(true)
    const ok = await lock.unlock(code)
    setBusy(false)
    if (!ok) fail()
  }, [busy, lock, fail])

  // PIN 达到期望位数自动提交
  useEffect(() => {
    if (lock.type !== 'pin') return
    if (pin.length >= expect && isValidPin(pin)) submit(pin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, expect, lock.type])

  const onPattern = useCallback((code, ok) => {
    if (!ok) { fail('手势至少连接 4 个点'); return }
    submit(code)
  }, [fail, submit])

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="应用已锁定">
      <div className={'lock-inner' + (shake ? ' shake' : '')} key={shake}>
        <img className="lock-icon" src="./icon-192.png" alt="" decoding="async" draggable={false} />
        <div className="lock-title">轻语记账</div>
        <div className="lock-sub">
          {lock.type === 'pin' ? `输入 ${expect} 位数字密码` : '绘制手势密码'}
        </div>

        {lock.type === 'pin'
          ? (
            <>
              <PinDots length={expect} filled={pin.length} />
              <PinPad value={pin} onChange={setPin} maxLen={6} autoFocusKey />
            </>
          )
          : <PatternPad onDone={onPattern} disabled={busy} />}

        <div className="lock-err" role="alert">{lock.error || ''}</div>

        <button type="button" className="lock-forgot" onClick={() => setForgot((v) => !v)}>
          忘记密码？
        </button>
        {forgot && (
          <div className="lock-hint">
            应用锁只保护本机界面、不参与云同步，也没有找回后门。<br />
            若确实遗忘，只能清除应用数据（系统设置 → 应用 → 轻语记账 → 存储 → 清除数据）。<br />
            已开启云备份的数据可在重装后同步回来。
          </div>
        )}
      </div>
    </div>
  )
}
