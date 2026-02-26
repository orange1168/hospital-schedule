# 排班问题分析

## 问题1：值班医生第二天没休息

**根本原因**：
1. 夜班分配时，`nextDayOff` 被正确填充
2. 但在白班分配时，`doctorsWorking` 的过滤逻辑没有正确排除休息的医生
3. 导致值班医生在第二天仍然被分配工作

**修复方法**：
1. 在白班分配开始时，将 `nextDayOff` 中的医生标记为 `off`
2. 在过滤 `doctorsWorking` 时，检查 `shifts[date] === 'off'`
3. 确保休息的医生不被选择

## 问题2：夜班医生当天不能排白班

**根本原因**：
1. 夜班分配时，`shifts[date] = 'night'`
2. 白班分配时，有夜班的医生被排除（因为 `shifts[date]` 不是空的）
3. 导致夜班医生当天不能排白班

**修复方法**：
1. 夜班医生当天应该可以排白班
2. 白班分配时，应该允许有夜班的医生参与
3. 使用 `nightShiftsByDate` 单独记录夜班状态

## 问题3：排班不均匀

**根本原因**：
1. 简单的"选择工作天数最少"算法可能导致某些医生一直被选
2. 需要引入随机性或更复杂的算法

**修复方法**：
1. 在选择医生时，如果有多个医生工作天数相同，随机选择
2. 或使用加权选择算法

## 修复代码

### 修改1：白班分配时正确排除休息的医生

```typescript
const todayOff = Array.from(nextDayOff)
nextDayOff.forEach(doctor => {
  doctorSchedule[doctor].shifts[date] = 'off'
})

const doctorsWorking = availableDoctors.filter(d =>
  !todayOff.includes(d) &&
  doctorSchedule[d].shifts[date] !== 'off'
)
```

### 修改2：夜班医生可以排白班

```typescript
// 夜班分配
doctorSchedule[selectedDoctor].nightShiftsByDate[date] = true
doctorSchedule[selectedDoctor].shifts[date] = 'night' // 临时标记，白班分配时会覆盖

// 白班分配（在科室分配时）
// 如果医生有夜班，也允许排白班
if (!doctorSchedule[bestDoctor].shifts[date] || doctorSchedule[bestDoctor].shifts[date] === 'off') {
  doctorSchedule[bestDoctor].shifts[date] = 'morning'
}
// 同时记录夜班状态
if (doctorSchedule[bestDoctor].nightShiftsByDate[date]) {
  // 有夜班，但同时也排了白班
}
```

### 修改3：优化排班算法

```typescript
// 在选择医生时，如果有多个医生工作天数相同，随机选择
const candidates = doctorsWorking.filter(doctor =>
  doctorWorkDays[doctor] === minWorkDays
)

if (candidates.length > 0) {
  bestDoctor = candidates[Math.floor(Math.random() * candidates.length)]
}
```
