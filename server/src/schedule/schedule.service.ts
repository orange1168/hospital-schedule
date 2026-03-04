import { Injectable, BadRequestException } from '@nestjs/common'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun } from 'docx'

// 固定的医生列表（14人）
const FIXED_DOCTORS = [
  '李茜', '姜维', '陈晓林', '高玲', '曹钰', '朱朝霞', '范冬黎', '杨波',
  '李丹', '黄丹', '邬海燕', '罗丹', '彭粤如', '周晓宇'
]

// 固定排班接口（支持半天班次）
export interface FixedSchedule {
  [date: string]: {
    [doctor: string]: {
      morning: string | '请输入' | '休息' | '请假'
      afternoon: string | '请输入' | '休息' | '请假'
    }
  }
}

// 班次类型
export type ShiftType = 'morning' | 'afternoon' | 'night' | 'off'

// 排班槽位
export interface ScheduleSlot {
  doctor: string
  shift: ShiftType
  department?: string
}

// 医生排班信息
export interface DoctorSchedule {
  name: string
  shifts: Record<string, {
    morning: 'work' | 'off' | 'night'
    afternoon: 'work' | 'off' | 'night'
  }> // key: date, value: { morning, afternoon }
  nightShiftsByDate: Record<string, boolean> // key: date, value: 是否有夜班
  departmentsByDate: Record<string, {
    morning: string
    afternoon: string
  }> // key: date, value: { morning, afternoon }科室名称
  morningShifts: string[] // 上午班次的科室列表
  afternoonShifts: string[] // 下午班次的科室列表
  morningShiftDays: number // 上午班天数
  afternoonShiftDays: number // 下午班天数
  nightShifts: number // 夜班次数
  restDays: number // 休息天数
}

export interface ScheduleData {
  dates: string[]
  datesWithWeek: string[]
  departments: string[]
  schedule: Record<string, Record<string, ScheduleSlot[]>> // 日期 -> 科室 -> 班次列表（可能包含上午、下午）
  dutySchedule: Record<string, string> // 日期 -> 夜班医生
  doctorSchedule: Record<string, DoctorSchedule> // 医生 -> 排班详情
  useHalfDay: boolean // 是否使用了半天排班
}

// 请假信息
export interface LeaveInfo {
  doctor: string // 医生姓名
  dates: string[] // 请假日期列表
}

@Injectable()
export class ScheduleService {
  // 科室列表
  private departments = [
    '1诊室', '2诊室', '4诊室', '5诊室', '9诊室', '10诊室',
    '妇儿2', '妇儿4', '妇儿前', 'VIP/男2', '男3', '女2'
  ]

  /**
   * 生成排班表
   * @param startDate 开始日期（YYYY-MM-DD）
   * @param doctors 医生列表（可以是字符串数组或对象数组）
   * @param dutyStartDoctor 值班起始医生
   * @param leaveDoctors 请假医生列表（字符串数组或对象数组）
   * @param fixedSchedule 固定排班数据（用户手动设置的）
   */
  async generateSchedule(
    startDate: string,
    doctors?: string[] | { name: string; isMainDuty?: boolean }[],
    dutyStartDoctor?: string,
    leaveDoctors?: string[] | LeaveInfo[],
    fixedSchedule?: FixedSchedule
  ): Promise<ScheduleData> {
    console.log('🔥 generateSchedule 被调用，startDate:', startDate)
    console.log('🔥 固定排班数据:', fixedSchedule)

    // 将医生列表转换为字符串数组
    const doctorList = doctors && doctors.length > 0
      ? doctors.map(d => typeof d === 'string' ? d : d.name)
      : FIXED_DOCTORS
    
    // 将请假信息转换为统一格式：Record<doctorName, date[]>
    const leaveMap: Record<string, string[]> = {}
    if (leaveDoctors && leaveDoctors.length > 0) {
      leaveDoctors.forEach(leave => {
        if (typeof leave === 'string') {
          // 旧格式：该医生一周都请假
          leaveMap[leave] = [] // 空数组表示一周都请假
        } else {
          // 新格式：指定请假日期
          leaveMap[leave.doctor] = leave.dates
        }
      })
      console.log('请假信息:', leaveMap)
    }

    console.log('🔴🔴🔴 开始生成排班，医生列表:', doctorList)
    console.log('🔴🔴🔴 值班起始医生:', dutyStartDoctor)
    console.log('🔴🔴🔴 请假医生:', leaveMap)
    console.log('🔴🔴🔴 固定排班数据:', fixedSchedule)

    if (doctorList.length === 0) {
      throw new BadRequestException('请至少添加一名医生')
    }

    // 检查是否有可用的医生
    const dates = this.getDates(startDate, 7)
    const availableDoctors = doctorList.filter(d => {
      // 如果医生在 leaveMap 中，检查是否有可用的日期
      if (leaveMap[d]) {
        // 如果 dates 数组为空，表示该医生一周都请假
        if (leaveMap[d].length === 0) {
          return false
        }
        // 如果有指定日期，检查是否所有日期都在请假列表中
        const allDatesLeave = dates.every(date => leaveMap[d].includes(date))
        return !allDatesLeave
      }
      return true
    })
    
    if (availableDoctors.length === 0) {
      throw new BadRequestException('没有可用的医生进行排班')
    }

    const datesWithWeek = dates.map(date => this.getDateWithWeek(date))
    
    // 初始化排班表结构
    const schedule: Record<string, Record<string, ScheduleSlot[]>> = {}
    dates.forEach(date => {
      schedule[date] = {}
      this.departments.forEach(dept => {
        schedule[date][dept] = []
      })
    })

    const dutySchedule: Record<string, string> = {}
    
    // 初始化医生排班记录
    const doctorSchedule: Record<string, DoctorSchedule> = {}
    doctorList.forEach(doctor => {
      doctorSchedule[doctor] = {
        name: doctor,
        shifts: {},
        nightShiftsByDate: {},
        departmentsByDate: {},
        morningShifts: [],
        afternoonShifts: [],
        morningShiftDays: 0,
        afternoonShiftDays: 0,
        nightShifts: 0,
        restDays: 0
      }
    })

    // 检查医生在特定日期是否请假
    const isDoctorOnLeave = (doctor: string, date: string): boolean => {
      const isLeave = !leaveMap[doctor] ? false : (leaveMap[doctor].length === 0 || leaveMap[doctor].includes(date))
      console.log(`🔴检查 ${doctor} 在 ${date} 是否请假: ${isLeave}, leaveMap[${doctor}] = ${leaveMap[doctor]}`)
      return isLeave
    }

    // 检查医生在固定排班中是否已分配（支持半天班次）
    const getFixedAssignment = (doctor: string, date: string): {
      morning: string | '请输入' | '休息' | '请假'
      afternoon: string | '请输入' | '休息' | '请假'
    } | null => {
      if (!fixedSchedule || !fixedSchedule[date] || !fixedSchedule[date][doctor]) {
        return null
      }
      return fixedSchedule[date][doctor]
    }

    // 获取日期的星期名称
    const getDayOfWeekName = (date: string): string => {
      const dateObj = new Date(date)
      const dayOfWeek = dateObj.getDay()
      const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      return dayNames[dayOfWeek]
    }

    // 🔴 CRITICAL: 先定义 restDatesMap，让 assignNightShifts 直接更新它
    // key: date, value: Set<doctor>
    const restDatesMap: Record<string, Set<string>> = {}

    // 步骤1：分配夜班（同时更新 restDatesMap）
    console.log('开始分配夜班...')
    this.assignNightShifts(
      dates,
      dutySchedule,
      availableDoctors,
      dutyStartDoctor,
      doctorSchedule,
      isDoctorOnLeave,
      getFixedAssignment, // 🔴 添加 getFixedAssignment 参数
      restDatesMap // 🔴 传递 restDatesMap 参数
    )

    console.log('🔴 restDatesMap 内容:')
    Object.entries(restDatesMap).forEach(([date, doctors]) => {
      console.log(`${date}: ${Array.from(doctors).join(', ')}`)
    })

    // 步骤2：分配上午和下午班次
    console.log('开始分配白班...')
    this.assignDayShifts(
      dates,
      schedule,
      dutySchedule, // ✅ 添加 dutySchedule 参数
      restDatesMap,
      availableDoctors,
      doctorSchedule,
      isDoctorOnLeave,
      getFixedAssignment
    )

    // 步骤3：检查每个医生的休息天数
    const failedDoctors = this.validateRestDays(doctorSchedule, dates, availableDoctors)
    if (failedDoctors.length > 0) {
      throw new BadRequestException(
        `人数不足，以下医生无法获得至少一天的休息：${failedDoctors.join('、')}`
      )
    }

    // 计算休息天数
    this.calculateRestDays(doctorSchedule, dates)

    return {
      dates,
      datesWithWeek,
      departments: this.departments,
      schedule,
      dutySchedule,
      doctorSchedule,
      useHalfDay: true // 支持半天排班
    }
  }

  /**
   * 分配夜班
   */
  private assignNightShifts(
    dates: string[],
    dutySchedule: Record<string, string>,
    availableDoctors: string[],
    dutyStartDoctor: string | undefined,
    doctorSchedule: Record<string, DoctorSchedule>,
    isDoctorOnLeave: (doctor: string, date: string) => boolean,
    getFixedAssignment: (doctor: string, date: string) => {
      morning: string | '请输入' | '休息' | '请假'
      afternoon: string | '请输入' | '休息' | '请假'
    } | null,
    restDatesMap: Record<string, Set<string>> // 🔴 添加 restDatesMap 参数
  ): void {
    // 找到值班起始医生在 FIXED_DOCTORS 中的索引
    let startIndex = 0
    if (dutyStartDoctor && FIXED_DOCTORS.includes(dutyStartDoctor)) {
      startIndex = FIXED_DOCTORS.indexOf(dutyStartDoctor)
    }

    // 🔴 CRITICAL: 基于可用医生列表进行轮换，而不是 FIXED_DOCTORS
    // 避免因医生数量不一致导致的索引错误
    let doctorIndex = 0
    if (dutyStartDoctor && availableDoctors.includes(dutyStartDoctor)) {
      doctorIndex = availableDoctors.indexOf(dutyStartDoctor)
      console.log(`🔴 值班起始医生设置为: ${dutyStartDoctor}, 索引: ${doctorIndex}`)
    }

    // 🔴 CRITICAL: 记录每个医生不能值班的剩余天数（确保至少休息2天）
    const doctorDutyBlockDays: Record<string, number> = {}

    dates.forEach((date, index) => {
      // 🔴 CRITICAL: 每天开始前，减少所有医生的不能值班天数
      Object.keys(doctorDutyBlockDays).forEach(doctor => {
        if (doctorDutyBlockDays[doctor] > 0) {
          doctorDutyBlockDays[doctor]--
          console.log(`🔴 ${doctor} 剩余不能值班天数: ${doctorDutyBlockDays[doctor]}`)
        }
      })

      // 🔴 CRITICAL: 智能选择值班医生 - 综合考虑累计休息天数和值班次数
      let selectedDoctor = ''

      // 计算每个医生的优先级（综合累计休息天数和值班次数）
      const doctorPriority: Record<string, number> = {}
      availableDoctors.forEach(doctor => {
        const isOnLeave = isDoctorOnLeave(doctor, date)
        const blockDays = doctorDutyBlockDays[doctor] || 0

        // 🔴 CRITICAL: 检查医生当天是否固定为"休息"或"请假"
        const fixedAssignment = getFixedAssignment(doctor, date)
        const isFixedRest = fixedAssignment && (fixedAssignment.morning === '休息' || fixedAssignment.afternoon === '休息')
        const isFixedLeave = fixedAssignment && (fixedAssignment.morning === '请假' || fixedAssignment.afternoon === '请假')

        // 如果请假或不能值班，优先级设为 -1
        if (isOnLeave || blockDays > 0 || isFixedRest || isFixedLeave) {
          doctorPriority[doctor] = -1
          console.log(`🔴 ${date} 医生 ${doctor}: 请假=${isOnLeave}, 不能值班=${blockDays}天, 固定休息=${isFixedRest}, 固定请假=${isFixedLeave}, 优先级=-1`)
        } else {
          // 🔴 CRITICAL: 从 restDatesMap 中统计累计休息天数（更准确）
          let totalRestDays = 0
          for (let i = 0; i < index; i++) {
            const checkDate = dates[i]
            // 检查这天该医生是否在休息列表中
            const isRest = restDatesMap[checkDate]?.has(doctor) || false
            const isDutyDate = dutySchedule[checkDate] === doctor

            // 如果这天是休息，且不是值班当天，则计入累计休息
            if (isRest && !isDutyDate) {
              totalRestDays++
            }
          }

          // 统计该医生已值班的次数
          let dutyCount = 0
          for (let i = 0; i < index; i++) {
            if (dutySchedule[dates[i]] === doctor) {
              dutyCount++
            }
          }

          // 🔴 CRITICAL: 综合优先级 = (值班次数 * 1000) + (累计休息天数 * 10)
          // 这样可以确保：
          // - 值班次数少的医生优先级更高（确保公平轮流值班）
          // - 值班次数相同时，累计休息天数多的医生优先级更高
          const priority = dutyCount * 1000 + totalRestDays * 10
          doctorPriority[doctor] = priority

          console.log(`🔴 ${date} 医生 ${doctor}: 累计休息${totalRestDays}天, 已值班${dutyCount}次, 优先级=${priority}`)
        }
      })

      // 🔴 CRITICAL: 先过滤掉不能值班的医生（优先级为-1的）
      const availableForDuty = availableDoctors.filter(doctor => doctorPriority[doctor] >= 0)

      console.log(`🔴 ${date} 可值班医生: ${availableForDuty.join(', ')}`)
      console.log(`🔴 ${date} 优先级: ${JSON.stringify(doctorPriority)}`)

      if (availableForDuty.length === 0) {
        throw new BadRequestException(`${date} 没有可用的值班医生（所有可用医生都请假或处于值班休息期）`)
      }

      // 🔴 CRITICAL: 选择优先级最低的医生（值班次数最少）
      // 如果优先级相同，按照值班起始医生的顺序选择
      selectedDoctor = availableForDuty.reduce((best, current) => {
        const bestPriority = doctorPriority[best]
        const currentPriority = doctorPriority[current]

        if (currentPriority < bestPriority) {
          return current
        } else if (currentPriority === bestPriority) {
          // 优先级相同，按照值班起始医生的顺序选择
          const bestIndex = (availableDoctors.indexOf(best) - doctorIndex + availableDoctors.length) % availableDoctors.length
          const currentIndex = (availableDoctors.indexOf(current) - doctorIndex + availableDoctors.length) % availableDoctors.length
          if (currentIndex < bestIndex) {
            return current
          }
        }
        return best
      })

      if (!selectedDoctor) {
        throw new BadRequestException(`${date} 没有可用的值班医生（所有可用医生都请假或处于值班休息期）`)
      }

      console.log(`🔴值班选择 ${date}: ${selectedDoctor} (优先级: ${doctorPriority[selectedDoctor]})`)

      dutySchedule[date] = selectedDoctor
      doctorSchedule[selectedDoctor].nightShiftsByDate[date] = true // 标记有夜班
      // 🔴 CRITICAL: 不设置 shifts[date] 和 departmentsByDate[date]，让白班分配时自动填充
      // 白班分配时，值班医生会被优先分配到第一个科室
      doctorSchedule[selectedDoctor].nightShifts++

      // 🔴 CRITICAL: 标记该医生在第二天休息（值班后休息1天）
      // 🔴 CRITICAL: 值班医生第二天休息不计入每周一天的休息要求中
      if (index + 1 < dates.length) {
        const nextDate = dates[index + 1]
        // 🔴 CRITICAL: 不将值班医生加入到 restDatesMap 中，因为值班后第二天休息不计入每周一天的休息要求
        // 但需要标记该医生在第二天不能工作（因为要休息）
        // 我们通过 doctorDutyBlockDays 来控制，而不是 restDatesMap
        console.log(`${date} 夜班医生 ${selectedDoctor}，${nextDate} 强制休息（不计入每周一天的休息要求中）`)
      }

      // 🔴 CRITICAL: 设置该医生不能值班的剩余天数为1
      doctorDutyBlockDays[selectedDoctor] = 1
      console.log(`${date} 夜班医生 ${selectedDoctor}，接下来1天不能值班`)

      doctorIndex++
    })

    console.log('🔴 restDatesMap 内容:')
    Object.entries(restDatesMap).forEach(([date, doctors]) => {
      console.log(`  ${date}: ${Array.from(doctors).join(', ')}`)
    })

    // 🔴 CRITICAL: 验证值班医生的休息日设置
    dates.forEach((date, index) => {
      const dutyDoctor = dutySchedule[date]
      if (dutyDoctor && index + 1 < dates.length) {
        const nextDate = dates[index + 1]
        console.log(`🔴 ${date} 值班医生 ${dutyDoctor}，应该休息的日期: ${nextDate}`)
        console.log(`  ${nextDate} restDatesMap: ${Array.from(restDatesMap[nextDate] || [])}`)
      }
    })
  }

  /**
   * 分配上午和下午班次
   */
  private assignDayShifts(
    dates: string[],
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    dutySchedule: Record<string, string>, // ✅ 添加 dutySchedule 参数
    restDatesMap: Record<string, Set<string>>,
    availableDoctors: string[],
    doctorSchedule: Record<string, DoctorSchedule>,
    isDoctorOnLeave: (doctor: string, date: string) => boolean,
    getFixedAssignment: (doctor: string, date: string) => {
      morning: string | '休息'
      afternoon: string | '休息'
    } | null
  ): void {
    // 🔴 CRITICAL: 不预先分配休息日，让值班医生的选择更灵活
    // 值班医生选择时优先选择休息时间最长的医生，自然确保公平
    const restAssigned: Set<string> = new Set() // 已分配休息的医生
    const nightDoctors: Set<string> = new Set() // 夜班医生集合
    
    // 收集所有夜班医生
    Object.values(doctorSchedule).forEach(info => {
      if (info.nightShifts > 0) {
        nightDoctors.add(info.name)
      }
    })

    // 记录每个医生的工作天数
    const doctorWorkDays: Record<string, number> = {}
    availableDoctors.forEach(doctor => {
      doctorWorkDays[doctor] = 0
    })

    // 记录每个医生每天是否已经排过班（避免重复统计天数）
    const doctorDailyWork: Record<string, Set<string>> = {}
    availableDoctors.forEach(doctor => {
      doctorDailyWork[doctor] = new Set()
    })

    dates.forEach((date, dateIndex) => {
      // 🔴 CRITICAL: 标记当天需要休息的医生（来自 restDatesMap，包括固定排班的休息）
      const todayOff = restDatesMap[date] || new Set()

      // 🔴 CRITICAL: 处理值班医生第二天休息（不计入每周一天的休息要求中）
      if (dateIndex > 0) {
        const prevDate = dates[dateIndex - 1]
        const prevDutyDoctor = dutySchedule[prevDate]
        if (prevDutyDoctor && !todayOff.has(prevDutyDoctor)) {
          // 将前一天值班的医生加入到休息名单中
          todayOff.add(prevDutyDoctor)
          console.log(`🔴 ${date} 前一天值班医生 ${prevDutyDoctor} 强制休息（不计入每周一天的休息要求中）`)
        }
      }

      // 🔴 CRITICAL: 当天的值班医生从休息名单中移除，因为值班医生需要上白班
      const todayDutyDoctor = dutySchedule[date]
      if (todayDutyDoctor && todayOff.has(todayDutyDoctor)) {
        todayOff.delete(todayDutyDoctor)
        console.log(`🔴 ${date} 值班医生 ${todayDutyDoctor} 从休息名单中移除，需要上白班`)
      }

      console.log(`🔴 ${date} 需要休息的医生: ${Array.from(todayOff).join(', ') || '无'}`)
      todayOff.forEach(doctor => {
        doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
        console.log(`  ${date} ${doctor} 设置为休息`)
      })

      // 🔴 CRITICAL: 先应用固定排班（支持半天班次）
      const fixedAssignedDoctors = new Set<string>()
      for (const doctor of availableDoctors) {
        const fixedAssignment = getFixedAssignment(doctor, date)
        if (fixedAssignment) {
          const { morning, afternoon } = fixedAssignment

          // 🔴 CRITICAL: 如果固定排班是"请输入"（空值），跳过处理，交给后续流程
          if (morning === '请输入' && afternoon === '请输入') {
            console.log(`  ${date} ${doctor} 固定排班为请输入，跳过处理`)
            continue
          }

          // 🔴 CRITICAL: 如果固定排班包含"请假"（额外休息，不算在每周一天的休息要求中）
          if (morning === '请假' || afternoon === '请假') {
            // 检查医生当天是否是值班医生
            if (doctor === todayDutyDoctor) {
              console.log(`  🔴 ${date} ${doctor} 是值班医生，跳过固定排班的请假设置`)
              fixedAssignedDoctors.add(doctor)
              continue
            }

            // 设置请假日（额外休息，不算在每周一天的休息要求中）
            if (!doctorSchedule[doctor].shifts[date]) {
              doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
            }
            if (morning === '请假') {
              doctorSchedule[doctor].shifts[date].morning = 'off'
            }
            if (afternoon === '请假') {
              doctorSchedule[doctor].shifts[date].afternoon = 'off'
            }
            console.log(`  ${date} ${doctor} 固定排班设置为请假（额外休息）`)
            fixedAssignedDoctors.add(doctor)
            continue
          }

          // 🔴 CRITICAL: 如果固定排班包含"休息"（算在每周一天的休息要求中）
          if (morning === '休息' || afternoon === '休息') {
            // 如果上下午都是休息，标记为全天休息
            if (morning === '休息' && afternoon === '休息') {
              // 🔴 CRITICAL: 如果医生当天是值班医生，跳过休息设置（值班医生当天必须上班）
              if (doctor === todayDutyDoctor) {
                console.log(`  🔴 ${date} ${doctor} 是值班医生，跳过固定排班的休息设置`)
                // 🔴 CRITICAL: 仍然将值班医生加入到 fixedAssignedDoctors 中，但标记为特殊状态
                fixedAssignedDoctors.add(doctor)
              } else {
                doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
                // 🔴 CRITICAL: 将休息医生加入到 restDatesMap 中，这样会算在每周一天的休息要求中
                if (!restDatesMap[date]) {
                  restDatesMap[date] = new Set()
                }
                restDatesMap[date].add(doctor)
                console.log(`  ${date} ${doctor} 固定排班设置为休息（算在每周一天的休息要求中）`)
                fixedAssignedDoctors.add(doctor)
              }
            }
            // 半天休息
            else {
              // 如果半天是休息，设置休息状态
              if (morning === '休息') {
                if (!doctorSchedule[doctor].shifts[date]) {
                  doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
                }
                doctorSchedule[doctor].shifts[date].morning = 'off'
                // 🔴 CRITICAL: 将休息医生加入到 restDatesMap 中
                if (!restDatesMap[date]) {
                  restDatesMap[date] = new Set()
                }
                restDatesMap[date].add(doctor)
                console.log(`  ${date} ${doctor} 固定排班设置为上午休息`)
              }
              if (afternoon === '休息') {
                if (!doctorSchedule[doctor].shifts[date]) {
                  doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
                }
                doctorSchedule[doctor].shifts[date].afternoon = 'off'
                // 🔴 CRITICAL: 将休息医生加入到 restDatesMap 中
                if (!restDatesMap[date]) {
                  restDatesMap[date] = new Set()
                }
                restDatesMap[date].add(doctor)
                console.log(`  ${date} ${doctor} 固定排班设置为下午休息`)
              }
              fixedAssignedDoctors.add(doctor)
            }
            continue
          }

          // 如果上下午都是同一个科室，标记为全天工作
          if (morning !== '请输入' && afternoon !== '请输入' && morning === afternoon) {
            schedule[date][morning].push({
              doctor: doctor,
              shift: 'morning',
              department: morning
            })
            schedule[date][afternoon].push({
              doctor: doctor,
              shift: 'afternoon',
              department: afternoon
            })

            doctorSchedule[doctor].shifts[date] = { morning: 'work', afternoon: 'work' }
            doctorSchedule[doctor].departmentsByDate[date] = { morning: morning, afternoon: afternoon }
            doctorSchedule[doctor].morningShifts.push(morning)
            doctorSchedule[doctor].afternoonShifts.push(afternoon)
            console.log(`  ${date} ${doctor} 固定排班设置为 ${morning}`)
          }
          // 半天班次
          else {
            // 处理上午班次
            if (morning !== '请输入') {
              schedule[date][morning].push({
                doctor: doctor,
                shift: 'morning',
                department: morning
              })
              if (!doctorSchedule[doctor].shifts[date]) {
                doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
              }
              doctorSchedule[doctor].shifts[date].morning = 'work'
              if (!doctorSchedule[doctor].departmentsByDate[date]) {
                doctorSchedule[doctor].departmentsByDate[date] = { morning: '', afternoon: '' }
              }
              doctorSchedule[doctor].departmentsByDate[date].morning = morning
              doctorSchedule[doctor].morningShifts.push(morning)
              console.log(`  ${date} ${doctor} 固定排班设置为上午 ${morning}`)
            }

            // 处理下午班次
            if (afternoon !== '请输入') {
              schedule[date][afternoon].push({
                doctor: doctor,
                shift: 'afternoon',
                department: afternoon
              })
              if (!doctorSchedule[doctor].shifts[date]) {
                doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
              }
              doctorSchedule[doctor].shifts[date].afternoon = 'work'
              if (!doctorSchedule[doctor].departmentsByDate[date]) {
                doctorSchedule[doctor].departmentsByDate[date] = { morning: '', afternoon: '' }
              }
              doctorSchedule[doctor].departmentsByDate[date].afternoon = afternoon
              doctorSchedule[doctor].afternoonShifts.push(afternoon)
              console.log(`  ${date} ${doctor} 固定排班设置为下午 ${afternoon}`)
            }
          }

          fixedAssignedDoctors.add(doctor)
        }
      }

      // 🔴 CRITICAL: 排除有固定排班的医生（全天或半天）
      const doctorsWorking = availableDoctors.filter(d =>
        !todayOff.has(d) &&
        !isDoctorOnLeave(d, date) &&
        (!fixedAssignedDoctors.has(d) || d === todayDutyDoctor) // 🔴 排除有固定排班的医生，但值班医生除外
      )

      console.log(`${date} 可用医生: ${doctorsWorking.join(', ') || '无'}`)
      console.log(`${date} fixedAssignedDoctors: ${Array.from(fixedAssignedDoctors).join(', ') || '无'}`)

      // 🔴 CRITICAL: 检查是否有值班医生在休息日被错误包含在工作列表中
      const dutyDoctor = dutySchedule[date]
      if (dutyDoctor && dateIndex > 0) {
        const prevDate = dates[dateIndex - 1]
        const prevDutyDoctor = dutySchedule[prevDate]

        // 检查前一天值班的医生是否在今天的休息名单中，但却在工作列表中
        if (prevDutyDoctor && todayOff.has(prevDutyDoctor)) {
          if (doctorsWorking.includes(prevDutyDoctor)) {
            console.log(`⚠️ 警告: ${prevDutyDoctor} 在 ${date} 应该休息（前一天值班），但仍在工作列表中！`)
          }
        }
      }

      // 判断是否是周末（周六或周日）
      const dateObj = new Date(date)
      const dayOfWeek = dateObj.getDay()
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 // 0是周日，6是周六

      // 周末只排3-4个科室，工作日排所有科室
      let departmentsForDay = this.departments
      if (isWeekend) {
        departmentsForDay = this.departments.slice(0, 4) // 只排前4个科室
      }

      console.log(`${date} (${isWeekend ? '周末' : '工作日'}) 需要排科室数量: ${departmentsForDay.length}`)

      // 🔴 CRITICAL: 周末优先为值班医生分配第一个诊室
      if (isWeekend && todayDutyDoctor && !doctorSchedule[todayDutyDoctor].shifts[date]) {
        const firstDepartment = departmentsForDay[0]
        console.log(`🔴 ${date} 周末优先为值班医生 ${todayDutyDoctor} 分配到 ${firstDepartment}`)

        schedule[date][firstDepartment].push({
          doctor: todayDutyDoctor,
          shift: 'morning',
          department: firstDepartment
        })
        schedule[date][firstDepartment].push({
          doctor: todayDutyDoctor,
          shift: 'afternoon',
          department: firstDepartment
        })

        doctorSchedule[todayDutyDoctor].shifts[date] = { morning: 'work', afternoon: 'work' }
        doctorSchedule[todayDutyDoctor].departmentsByDate[date] = { morning: firstDepartment, afternoon: firstDepartment }
        doctorSchedule[todayDutyDoctor].morningShifts.push(firstDepartment)
        doctorSchedule[todayDutyDoctor].afternoonShifts.push(firstDepartment)
      }

      // 🔴 CRITICAL: 记录已分配的科室（包括固定排班）
      const assignedDepartments = new Set<string>()
      for (const dept of departmentsForDay) {
        if (schedule[date][dept].length > 0) {
          assignedDepartments.add(dept)
        }
      }

      // 🔴 CRITICAL: 为每个科室分配医生（全天）
      departmentsForDay.forEach((dept, deptIndex) => {
        // 🔴 跳过已经分配的科室（包括固定排班）
        if (assignedDepartments.has(dept)) {
          console.log(`${date} ${dept} 已分配（可能是固定排班），跳过`)
          return
        }

        if (doctorsWorking.length > 0) {
          // 🔴 CRITICAL: 正常分配医生到科室
          let bestDoctor = ''
          const dutyDoctor = dutySchedule[date] // 获取当天的值班医生

          // 优先级1: 值班医生（仅限第一个科室）
          if (deptIndex === 0 && dutyDoctor &&
              doctorsWorking.includes(dutyDoctor) &&
              !doctorSchedule[dutyDoctor].shifts[date]) {
            bestDoctor = dutyDoctor
            console.log(`${date} ${dept} 优先分配值班医生: ${bestDoctor}`)
          }
          // 优先级2: 选择工作天数最少的医生
          else {
            let minWorkDays = Infinity
            const candidates: string[] = []
            for (const doctor of doctorsWorking) {
              // 检查这个医生今天是否已经排过班
              const alreadyHasShift = doctorSchedule[doctor].shifts[date] &&
                                       (doctorSchedule[doctor].shifts[date].morning === 'work' ||
                                        doctorSchedule[doctor].shifts[date].afternoon === 'work')

              if (!alreadyHasShift) {
                if (doctorWorkDays[doctor] < minWorkDays) {
                  minWorkDays = doctorWorkDays[doctor]
                  candidates.length = 0 // 清空候选列表
                }
                if (doctorWorkDays[doctor] === minWorkDays) {
                  candidates.push(doctor)
                }
              }
            }

            // 随机选择一个候选医生
            if (candidates.length > 0) {
              bestDoctor = candidates[Math.floor(Math.random() * candidates.length)]
            }
          }

          // 如果找到合适的医生，则分配
          if (bestDoctor) {
            schedule[date][dept].push({
              doctor: bestDoctor,
              shift: 'morning',
              department: dept
            })

            schedule[date][dept].push({
              doctor: bestDoctor,
              shift: 'afternoon',
              department: dept
            })

            // 🔴 CRITICAL: 设置全天班次
            doctorSchedule[bestDoctor].shifts[date] = { morning: 'work', afternoon: 'work' }
            doctorSchedule[bestDoctor].departmentsByDate[date] = { morning: dept, afternoon: dept }
            doctorSchedule[bestDoctor].morningShifts.push(dept)
            doctorSchedule[bestDoctor].afternoonShifts.push(dept)

            // 统计天数：如果这个医生今天还没排过班，则天数+1
            if (!doctorDailyWork[bestDoctor].has(date)) {
              doctorDailyWork[bestDoctor].add(date)
              doctorWorkDays[bestDoctor]++
            }

            console.log(`${date} ${dept} 分配给 ${bestDoctor}`)
          } else {
            console.log(`${date} ${dept} 没有找到合适的医生`)
          }
        }
      })
    })

    // 计算上午班和下午班的天数
    Object.values(doctorSchedule).forEach(info => {
      // 统计上午班天数（排除值班当天）
      const morningDays = new Set<string>()
      dates.forEach(date => {
        // 🔴 CRITICAL: 值班当天不计入上午班天数
        if (info.shifts[date]?.morning === 'work' && !info.nightShiftsByDate[date]) {
          morningDays.add(date)
        }
      })
      info.morningShiftDays = morningDays.size

      // 统计下午班天数（下午班和上午班同一天，排除值班当天）
      const afternoonDays = new Set<string>()
      dates.forEach(date => {
        // 🔴 CRITICAL: 值班当天不计入下午班天数
        if (info.shifts[date]?.afternoon === 'work' && !info.nightShiftsByDate[date]) {
          afternoonDays.add(date)
        }
      })
      info.afternoonShiftDays = afternoonDays.size
    })

    console.log('日班分配完成，各医生工作天数:', doctorWorkDays)

    // 🔴 CRITICAL: 打印值班医生的排班详情
    console.log('🔴 值班医生排班详情:')
    dates.forEach((date, index) => {
      const dutyDoctor = dutySchedule[date]
      if (dutyDoctor) {
        console.log(`  ${date} 值班: ${dutyDoctor}, shifts[${date}] = ${doctorSchedule[dutyDoctor].shifts[date]}, departmentsByDate[${date}] = ${(doctorSchedule[dutyDoctor] as any).departmentsByDate[date]}`)
      }
    })
  }

  /**
   * 验证休息天数
   */
  private validateRestDays(
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[],
    availableDoctors: string[]  // 只验证可用医生的休息天数
  ): string[] {
    const failedDoctors: string[] = []

    // 只验证可用医生（不包括请假医生）
    availableDoctors.forEach(doctorName => {
      const info = doctorSchedule[doctorName]
      if (!info) return

      // 计算工作天数（包括白班和夜班）
      const workDays = dates.filter(date =>
        info.shifts[date] &&
        (info.shifts[date].morning === 'work' || info.shifts[date].afternoon === 'work')
      ).length

      // 休息天数 = 总天数 - 工作天数
      const restDays = dates.length - workDays

      console.log(`${info.name}: 工作天数=${workDays}, 休息天数=${restDays}, shifts=${JSON.stringify(info.shifts)}`)

      // 检查休息天数是否不足
      if (restDays < 1) {
        failedDoctors.push(info.name)
      }
    })

    return failedDoctors
  }

  /**
   * 计算休息天数
   * 🔴 CRITICAL: 统计总休息天数（包括值班后的休息日和普通的休息日）
   */
  private calculateRestDays(
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[]
  ): void {
    Object.values(doctorSchedule).forEach(info => {
      // 🔴 CRITICAL: 统计所有休息日的天数（上午和下午都休息才算1天，半天休息算0.5天）
      let restDays = 0

      dates.forEach(date => {
        const shift = info.shifts[date]
        if (shift) {
          // 如果全天休息，加1天
          if (shift.morning === 'off' && shift.afternoon === 'off') {
            restDays += 1
          }
          // 如果半天休息，加0.5天
          else if (shift.morning === 'off' || shift.afternoon === 'off') {
            restDays += 0.5
          }
        }
      })

      info.restDays = restDays
    })
  }

  /**
   * 获取日期列表
   */
  private getDates(startDate: string, days: number): string[] {
    const dates: string[] = []
    const start = new Date(startDate)

    for (let i = 0; i < days; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      dates.push(date.toISOString().split('T')[0])
    }

    return dates
  }

  /**
   * 获取日期和星期
   */
  private getDateWithWeek(date: string): string {
    const dateObj = new Date(date)
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const dayOfWeek = dateObj.getDay()

    return `${date.split('-')[1]}-${date.split('-')[2]} ${dayNames[dayOfWeek]}`
  }

  /**
   * 生成Word文档
   */
  async generateWordDoc(scheduleData: ScheduleData, startDate: string): Promise<Buffer> {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `医院排班表 (${startDate} 起一周)`,
                  bold: true,
                  size: 32
                })
              ],
              alignment: 'center',
              spacing: { after: 200 }
            }),
            // 值班表
            new Paragraph({
              children: [
                new TextRun({
                  text: '夜间值班',
                  bold: true,
                  size: 24
                })
              ],
              spacing: { before: 200, after: 100 }
            }),
            this.createDutyScheduleTable(scheduleData),
            // 白班排班表
            new Paragraph({
              children: [
                new TextRun({
                  text: '白班排班（含上午/下午）',
                  bold: true,
                  size: 24
                })
              ],
              spacing: { before: 400, after: 100 }
            }),
            this.createDayScheduleTable(scheduleData),
            // 医生排班统计
            new Paragraph({
              children: [
                new TextRun({
                  text: '医生排班统计',
                  bold: true,
                  size: 24
                })
              ],
              spacing: { before: 400, after: 100 }
            }),
            this.createDoctorStatsTable(scheduleData)
          ]
        }
      ]
    })

    return await Packer.toBuffer(doc)
  }

  /**
   * 创建值班表
   */
  private createDutyScheduleTable(scheduleData: ScheduleData): Table {
    const { dates, dutySchedule, datesWithWeek } = scheduleData

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '日期', bold: true })] }),
              ],
              width: { size: 50, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '值班医生', bold: true })] }),
              ],
              width: { size: 50, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
        ...dates.map(
          (date) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(datesWithWeek[dates.indexOf(date)])] })],
                  width: { size: 50, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(dutySchedule[date] || '-')] })],
                  width: { size: 50, type: WidthType.PERCENTAGE },
                }),
              ],
            })
        ),
      ],
      borders: {
        top: { style: BorderStyle.SINGLE },
        bottom: { style: BorderStyle.SINGLE },
        left: { style: BorderStyle.SINGLE },
        right: { style: BorderStyle.SINGLE },
      },
    })
  }

  /**
   * 创建白班排班表
   */
  private createDayScheduleTable(scheduleData: ScheduleData): Table {
    const { dates, datesWithWeek, departments, schedule } = scheduleData

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '科室', bold: true })] }),
              ],
              width: { size: 15, type: WidthType.PERCENTAGE },
            }),
            ...dates.map(
              (date) =>
                new TableCell({
                  children: [
                    new Paragraph({ children: [new TextRun({ text: datesWithWeek[dates.indexOf(date)], bold: true, size: 18 })] }),
                  ],
                  width: { size: 85 / dates.length, type: WidthType.PERCENTAGE },
                })
            ),
          ],
        }),
        ...departments.map(
          (department) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: department, bold: true })] })],
                  width: { size: 15, type: WidthType.PERCENTAGE },
                }),
                ...dates.map((date) => {
                  const slots = schedule[date]?.[department] || []
                  const doctors = slots.map((s) => {
                    const suffix = s.shift === 'morning' ? '（上午）' : '（下午）'
                    return `${s.doctor}${suffix}`
                  }).join('、')
                  return new TableCell({
                    children: [new Paragraph({ children: [new TextRun(doctors || '-')] })],
                    width: { size: 85 / dates.length, type: WidthType.PERCENTAGE },
                  })
                }),
              ],
            })
        ),
      ],
      borders: {
        top: { style: BorderStyle.SINGLE },
        bottom: { style: BorderStyle.SINGLE },
        left: { style: BorderStyle.SINGLE },
        right: { style: BorderStyle.SINGLE },
      },
    })
  }

  /**
   * 创建医生统计表
   */
  private createDoctorStatsTable(scheduleData: ScheduleData): Table {
    const { doctorSchedule } = scheduleData

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '医生', bold: true })] }),
              ],
              width: { size: 20, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '夜班次数', bold: true })] }),
              ],
              width: { size: 20, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '上午班(天)', bold: true })] }),
              ],
              width: { size: 20, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '下午班(天)', bold: true })] }),
              ],
              width: { size: 20, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '休息天数', bold: true })] }),
              ],
              width: { size: 20, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
        ...Object.values(doctorSchedule).map(
          (info) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(info.name)] })],
                  width: { size: 20, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(String(info.nightShifts))] })],
                  width: { size: 20, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(String(info.morningShiftDays || info.morningShifts.length))] })],
                  width: { size: 20, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(String(info.afternoonShiftDays || info.afternoonShifts.length))] })],
                  width: { size: 20, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(String(info.restDays))] })],
                  width: { size: 20, type: WidthType.PERCENTAGE },
                }),
              ],
            })
        ),
      ],
      borders: {
        top: { style: BorderStyle.SINGLE },
        bottom: { style: BorderStyle.SINGLE },
        left: { style: BorderStyle.SINGLE },
        right: { style: BorderStyle.SINGLE },
      },
    })
  }
}
