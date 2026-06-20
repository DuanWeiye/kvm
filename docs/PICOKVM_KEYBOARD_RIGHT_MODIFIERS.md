# Luckfox PicoKVM —— 右侧 Ctrl/Shift 等修饰键透传修复（前端键盘）

> 适用工程：`~/Documents/picokvm`（见记忆 `picokvm-build-env`）。
> **本文是改动流程的「第五步」**：第一步＝安全加固 [PICOKVM_SECURITY_HARDENING.md](PICOKVM_SECURITY_HARDENING.md)；第二步＝拆远程组网 [PICOKVM_STRIP_REMOTE_NET.md](PICOKVM_STRIP_REMOTE_NET.md)；
> 第三步＝登录 fail2ban [PICOKVM_FAIL2BAN_LOGIN.md](PICOKVM_FAIL2BAN_LOGIN.md)；第四步＝USB 改造 [PICOKVM_USB_STORAGE.md](PICOKVM_USB_STORAGE.md)；
> 第五步＝本文（前端键盘右修饰键）；第六步/最后一步＝部署 [PICOKVM_DEPLOY_DEVICE.md](PICOKVM_DEPLOY_DEVICE.md)。
> 首次实施并验证通过：2026-06-20。

---

## 0. 现象
被控页面里，物理键盘**左** Ctrl/Shift 能透传进被控主机，**右** Ctrl/Shift 无效。
进一步观察底栏「Keys:」区：按左 Ctrl 显示 `ControlLeft`，按右 Ctrl/Shift **完全无显示**。

---

## 1. 定位方法（少走弯路的关键）

### 1.1 底栏「Keys:」是现成的探针
`ui/src/layout/core/bar_bottom/BottomBarPC.tsx` 的 `PressedKeysDisplay` 把 `activeModifiers`（数值）**反查**回名字显示：
```ts
activeModifiers.map(x => Object.entries(modifiers).filter(y => y[1] === x)[0][0])
```
所以「右 Ctrl 无显示」＝ `activeModifiers` 根本没拿到对应位 ＝ keydown 没产出修饰位。用它就能判断问题出在「事件→修饰位」这一段，而不是后端/USB。

### 1.2 先证明「光重新构建没用」——新旧 bundle 逐字节对比
怀疑是不是部署的前端是旧版。把实机正在跑的 bundle 抓下来，和本地新构建产物对比物理键盘的核心逻辑 `handleModifierKeys`：
```bash
# 实机首页找主 JS → 下载；本地 ../static/assets/index-*.js
# 用 python 抽出含 shiftKey/ctrlKey/ShiftRight 的过滤链片段对比
```
结论：两边**完全相同**。说明物理键盘逻辑没变过，**只重新部署改不了行为**——必须真正改源码。这一步避免了一次无效的部署+reboot。

### 1.3 拿到真实事件值——浏览器 DevTools 一行话
源码层面分不清是 `e.code` 异常还是 `e.ctrlKey` 标志异常，直接在被控页面 Console 跑：
```js
addEventListener('keydown',e=>console.log('code='+e.code,'key='+e.key,'loc='+e.location,'ctrl='+e.ctrlKey,'shift='+e.shiftKey),true)
```
依次按 左Ctrl/右Ctrl/左Shift/右Shift。实测这把键盘：
- 右 Ctrl：`code=ControlRight loc=2 ctrl=true` —— **正常**（其实能用）。
- 右 Shift：**`code=`（空字符串）**、`key=Shift`、**`loc=0`**、`shift=true` —— **异常**。

---

## 2. 根因
前端 keydown 全程按 `e.code` 查表得修饰位（`useKeyboardEvents.ts`）：
```ts
const newModifiers = handleModifierKeys(e, [...prev.activeModifiers, modifiers[code]]);
```
某些键盘/系统对右侧修饰键上报的 `e.code` 不符合 W3C 规范（实测右 Shift 给出**空 code**、`location=0`）。`modifiers[""]` 是 `undefined` → 该修饰位加不进去 → 既不显示也不透传。左键因 `e.code="ShiftLeft"/"ControlLeft"` 正常，所以能用。

> 注意区分：这是**物理键盘**路径（`useKeyboardEvents.ts`）的问题。屏幕**虚拟键盘** `VirtualKeyboard.tsx` 另有一处左右不对称的真 bug（`ControlRight` 无分支、`ShiftRight` 写死发 `ShiftLeft`，而 `AltRight`/`MetaRight` 却是对的），顺手一并修了，但它不是本次现象的根因。

---

## 3. 修法

### 3.1 物理键盘：`e.code` 查不到时用 `e.key`+`e.location` 兜底
`ui/src/layout/core/desktop/hooks/useKeyboardEvents.ts`，模块级加：
```ts
// location: 2=右侧；其余值（含异常的 0）按左侧处理——功能上 Shift/Ctrl 即 Shift/Ctrl。
const modifierFromKeyEvent = (key: string, location: number): number | undefined => {
  switch (key) {
    case "Control": return location === 2 ? modifiers["ControlRight"] : modifiers["ControlLeft"];
    case "Shift":   return location === 2 ? modifiers["ShiftRight"] : modifiers["ShiftLeft"];
    case "Alt":     return location === 2 ? modifiers["AltRight"] : modifiers["AltLeft"];
    case "Meta":
    case "OS":      return location === 2 ? modifiers["MetaRight"] : modifiers["MetaLeft"];
    default:        return undefined;
  }
};
```
`keyDownHandler` 里计算修饰位时回退 + **强制保留刚按下的修饰键**（防 `ctrlKey/shiftKey` 标志滞后被 `handleModifierKeys` 误删）：
```ts
let pressedModifier: number | undefined = modifiers[code];
if (pressedModifier === undefined && keys[code] === undefined) {
  pressedModifier = modifierFromKeyEvent(key, e.location);
}
const baseModifiers = pressedModifier !== undefined
  ? [...prev.activeModifiers, pressedModifier] : prev.activeModifiers;
const newModifiers = handleModifierKeys(e, baseModifiers);
if (pressedModifier !== undefined && !newModifiers.includes(pressedModifier)) {
  newModifiers.push(pressedModifier);
}
```
`keyUpHandler` 用同样的兜底算出 `releasedModifier` 再从列表移除，确保异常 `e.code` 的右键也能干净释放、不残留（否则 `modifiers[""]` 移不掉，靠标志位清理虽多数能兜住，但显式移除更稳）。
> TS 坑：`modifiers` 是 `Record<string, number>`，`modifiers[code]` 被推成 `number`，赋 `number|undefined` 会报 TS2322 → 变量要显式标 `: number | undefined`；传入 `handleModifierKeys`（形参 `number[]`）前要剔掉 `undefined`。

### 3.2 虚拟键盘左右对称（顺手）
`ui/src/components/VirtualKeyboard.tsx` `onKeyDown`：`ControlLeft || ControlRight` 合并、直接模式发 `modifiers[key]`；Shift 直接模式按 `key==="ShiftRight"` 发右、否则左；`isModifierKey` 补 `ControlRight`；锁定高亮 `lockedModifiers.ctrl` 由 `"ControlLeft"`→`"ControlLeft ControlRight"`。

### 3.3 底栏显示不区分左右
硬件给右 Shift 的是空 code、`location=0`，**没有任何「右」信号**，软件无法判定左右 → 底栏统一显示 `Ctrl/Shift/Alt/Meta`，避免「按右 Shift 却显示 ShiftLeft」的困惑。`BottomBarPC.tsx` 加 `modifierLabelNoSide` 映射（ControlLeft/Right→Ctrl…），反查后过一遍。（移动端底栏无此显示。）

---

## 4. 构建与验证
```bash
cd ~/Documents/picokvm/ui && npm run build:device     # 前端改了，先出 static/
cd ~/Documents/picokvm && export PATH="$HOME/sdk/go1.25.5/bin:$PATH"
make build_dev VERSION_DEV=0.1.3 \
     OTA_PUBLIC_KEY=4d78341c5c66fd5c09635d45ad3aa0ae7ab131f9e945868ec9726fbc1367a452
```
按第六步 [PICOKVM_DEPLOY_DEVICE.md](PICOKVM_DEPLOY_DEVICE.md) 部署。验证：刷新被控页面清掉手动 console 监听后，按右 Ctrl/右 Shift 能透传；底栏统一显示 `Ctrl`/`Shift`。

> 兼容性：`location===2` 能正确报右的键盘会被识别成右修饰位；上报 `location=0` 的（如本次实测键盘）按左处理，功能等价。

---

## 5. 同步上游后复用锚点
- `useKeyboardEvents.ts`：`handleModifierKeys`、`keyDownHandler` 里 `[...prev.activeModifiers, modifiers[code]]` 这行就是注入点。
- `VirtualKeyboard.tsx`：`onKeyDown` 内 `if (key === "ControlLeft")` / `isKeyShift` 分支。
- `BottomBarPC.tsx`：`PressedKeysDisplay` 的 `activeModifiers.map(...)`。
