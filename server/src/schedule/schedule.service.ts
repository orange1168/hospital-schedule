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
      morning: string | '休息' | '请假'
      afternoon: string | '休息' | '请假'
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
    fixedSchedule?: FixedSchedule,
    departmentNames?: string[] // 科室列表
  ): Promise<ScheduleData> {
    console.log('🔥 generateSchedule 被调用，startDate:', startDate)
    console.log('🔥 科室列表:', departmentNames)
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

    console.log('🔴🔴🔴 availableDoctors:', availableDoctors)
    console.log('🔴🔴🔴 availableDoctors.length:', availableDoctors.length)
    console.log('🔴🔴🔴 doctorList:', doctorList)

    if (availableDoctors.length === 0) {
      throw new BadRequestException('没有可用的医生进行排班')
    }

    // 🔴 CRITICAL: 使用用户传入的科室列表，如果没有则使用默认科室
    const departments = departmentNames && departmentNames.length > 0
      ? departmentNames
      : this.departments

    console.log('🔴🔴🔴 使用的科室列表:', departments)
    console.log('🔴🔴🔴 可用医生列表:', availableDoctors)
    console.log('🔴🔴🔴 可用医生数量:', availableDoctors.length)
    console.log('🔴🔴🔴 总医生数量:', doctorList.length)
    console.log('🔴🔴🔴 排班日期数量:', dates.length)

    // 🔴 CRITICAL: 验证医生数量是否足够
    // 每天需要 departments.length × 2 个班次（上午和下午）
    // 值班医生第二天休息，值班周期 2 天
    // 在 2 天的值班周期中：
    //   - 第一天：值班医生工作 2 个班次，其他医生也工作
    //   - 第二天：值班医生休息，其他医生工作
    // 平均每天需要的医生数量 = ceil(2 × departments.length / 3)
    // 解释：
    //   - 每天需要 2 × departments.length 个班次
    //   - 值班周期 2 天中，值班医生只工作第一天（2 个班次），平均每天贡献 1 个班次
    //   - 所以 N 个医生在 2 天周期中可提供 2N - 1 个班次
    //   - 需要 2N - 1 >= 4 × departments.length
    //   - 即 N >= ceil(2 × departments.length / 3)
    // 最少医生数量 = ceil(2 × departments.length / 3) + 1（+1 是值班医生）
    const avgDoctorsNeeded = Math.ceil(2 * departments.length / 3)
    const minDoctorsNeeded = avgDoctorsNeeded + 1

    console.log('🔴🔴🔴 平均每天需要的医生数量:', avgDoctorsNeeded)
    console.log('🔴🔴🔴 最少需要的医生数量:', minDoctorsNeeded)

    if (availableDoctors.length < minDoctorsNeeded) {
      throw new BadRequestException(
        `医生数量不足！${departments.length}个科室每天需要${departments.length * 2}个班次，` +
        `值班医生第二天休息，至少需要${minDoctorsNeeded}个医生（平均每天${avgDoctorsNeeded}个），` +
        `当前只有${availableDoctors.length}个可用医生。`
      )
    }

    const datesWithWeek = dates.map(date => this.getDateWithWeek(date))

    // 初始化排班表结构
    const schedule: Record<string, Record<string, ScheduleSlot[]>> = {}
    dates.forEach(date => {
      schedule[date] = {}
      departments.forEach(dept => {
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
      morning: string | '休息' | '请假'
      afternoon: string | '休息' | '请假'
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

    // 步骤1：分配夜班
    console.log('开始分配夜班...')
    this.assignNightShifts(
      dates,
      dutySchedule,
      availableDoctors,
      dutyStartDoctor,
      doctorSchedule,
      isDoctorOnLeave,
      getFixedAssignment
    )

    // 🔴 CRITICAL: 检查值班医生是否在固定排班中被设置为休息，如果是则重新选择
    this.validateAndAdjustDutyDoctors(dates, dutySchedule, fixedSchedule, doctorSchedule)

    // 步骤2：分配白班（逐日处理）
    console.log('开始分配白班...')
    this.assignDayShifts(
      dates,
      schedule,
      dutySchedule,
      availableDoctors,
      doctorSchedule,
      isDoctorOnLeave,
      getFixedAssignment,
      departments // 🔴 CRITICAL: 传递科室列表
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
      departments, // 🔴 CRITICAL: 使用实际的科室列表
      schedule,
      dutySchedule,
      doctorSchedule,
      useHalfDay: true // 支持半天排班
    }
  }

  /**
   * 状态判断函数：判断医生在指定日期是否已分配
   */
  private isAssigned(doctor: string, date: string, doctorSchedule: Record<string, DoctorSchedule>): boolean {
    return doctorSchedule[doctor]?.shifts[date] !== undefined
  }

  /**
   * 状态判断函数：判断医生在指定日期是否工作（上午或下午）
   */
  private isWorking(doctor: string, date: string, doctorSchedule: Record<string, DoctorSchedule>): boolean {
    const shift = doctorSchedule[doctor]?.shifts[date]
    return shift?.morning === 'work' || shift?.afternoon === 'work'
  }

  /**
   * 状态判断函数：判断医生在指定日期是否休息（上午或下午）
   */
  private isResting(doctor: string, date: string, doctorSchedule: Record<string, DoctorSchedule>): boolean {
    const shift = doctorSchedule[doctor]?.shifts[date]
    return shift?.morning === 'off' || shift?.afternoon === 'off'
  }

  /**
   * 状态判断函数：判断医生在指定日期是否全天休息
   */
  private isFullDayRest(doctor: string, date: string, doctorSchedule: Record<string, DoctorSchedule>): boolean {
    const shift = doctorSchedule[doctor]?.shifts[date]
    return shift?.morning === 'off' && shift?.afternoon === 'off'
  }

  /**
   * 状态判断函数：判断医生前一天是否值班
   */
  private isDutyYesterday(
    doctor: string,
    date: string,
    dutySchedule: Record<string, string>,
    dates: string[],
    dateIndex: number
  ): boolean {
    if (dateIndex === 0) return false
    const yesterday = dates[dateIndex - 1]
    return dutySchedule[yesterday] === doctor
  }

  /**
   * 状态设置函数：设置医生休息
   */
  private setRest(
    doctor: string,
    date: string,
    doctorSchedule: Record<string, DoctorSchedule>
  ): void {
    doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
    doctorSchedule[doctor].departmentsByDate[date] = { morning: '', afternoon: '' }
  }

  /**
   * 状态设置函数：设置医生工作（指定科室）
   */
  private setWork(
    doctor: string,
    date: string,
    department: string,
    shift: 'morning' | 'afternoon',
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    doctorSchedule: Record<string, DoctorSchedule>
  ): void {
    schedule[date][department].push({
      doctor: doctor,
      shift: shift,
      department: department
    })

    if (!doctorSchedule[doctor].shifts[date]) {
      doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
    }
    doctorSchedule[doctor].shifts[date][shift] = 'work'

    if (!doctorSchedule[doctor].departmentsByDate[date]) {
      doctorSchedule[doctor].departmentsByDate[date] = { morning: '', afternoon: '' }
    }
    doctorSchedule[doctor].departmentsByDate[date][shift] = department

    if (shift === 'morning') {
      doctorSchedule[doctor].morningShifts.push(department)
    } else {
      doctorSchedule[doctor].afternoonShifts.push(department)
    }
  }

  /**
   * 状态设置函数：设置医生全天工作（同一科室）
   */
  private setFullDayWork(
    doctor: string,
    date: string,
    department: string,
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    doctorSchedule: Record<string, DoctorSchedule>
  ): void {
    this.setWork(doctor, date, department, 'morning', schedule, doctorSchedule)
    this.setWork(doctor, date, department, 'afternoon', schedule, doctorSchedule)
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
      morning: string | '休息' | '请假'
      afternoon: string | '休息' | '请假'
    } | null
  ): void {
    // 找到值班起始医生在 availableDoctors 中的索引
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
          // 🔴 CRITICAL: 统计累计休息天数（从 shifts 中统计）
          let totalRestDays = 0
          for (let i = 0; i < index; i++) {
            const checkDate = dates[i]
            const isRest = this.isFullDayRest(doctor, checkDate, doctorSchedule)
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
      doctorSchedule[selectedDoctor].nightShifts++

      // 🔴 CRITICAL: 设置该医生不能值班的剩余天数为1
      doctorDutyBlockDays[selectedDoctor] = 1
      console.log(`${date} 夜班医生 ${selectedDoctor}，接下来1天不能值班`)
    })

    console.log('🔴 值班分配完成')
  }

  /**
   * 验证并调整值班医生：检查值班医生是否在固定排班中被设置为休息，如果是则重新选择
   */
  private validateAndAdjustDutyDoctors(
    dates: string[],
    dutySchedule: Record<string, string>,
    fixedSchedule: FixedSchedule | undefined,
    doctorSchedule: Record<string, DoctorSchedule>
  ): void {
    let hasAdjustment = false

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      const dutyDoctor = dutySchedule[date]

      if (!dutyDoctor) continue

      // 检查值班医生在固定排班中是否被设置为休息或请假
      const fixed = fixedSchedule?.[date]?.[dutyDoctor]
      if (fixed) {
        const isRest = fixed.morning === '休息' || fixed.afternoon === '休息'
        const isLeave = fixed.morning === '请假' || fixed.afternoon === '请假'

        if (isRest || isLeave) {
          console.log(`⚠️ ${date} 值班医生 ${dutyDoctor} 在固定排班中被设置为${isRest ? '休息' : '请假'}，需要重新选择`)

          // 移除原来的夜班标记
          delete doctorSchedule[dutyDoctor].nightShiftsByDate[date]
          doctorSchedule[dutyDoctor].nightShifts--

          // 重新选择值班医生（排除已休息或请假的医生）
          const availableDoctors = Object.keys(doctorSchedule).filter(doctor => {
            // 排除原来的值班医生
            if (doctor === dutyDoctor) return false

            // 排除固定排班中休息或请假的医生
            const fixed = fixedSchedule?.[date]?.[doctor]
            if (fixed && (fixed.morning === '休息' || fixed.afternoon === '休息' || fixed.morning === '请假' || fixed.afternoon === '请假')) {
              return false
            }

            // 排除当天已经有夜班的医生
            return !doctorSchedule[doctor].nightShiftsByDate[date]
          })

          if (availableDoctors.length === 0) {
            throw new BadRequestException(`${date} 没有可用的值班医生（所有可用医生都请假或处于值班休息期）`)
          }

          // 选择优先级最低的医生（选择轮到的人）
          const newDutyDoctor = availableDoctors[0]
          console.log(`✅ ${date} 重新选择值班医生: ${newDutyDoctor}`)

          // 更新值班医生
          dutySchedule[date] = newDutyDoctor
          doctorSchedule[newDutyDoctor].nightShiftsByDate[date] = true
          doctorSchedule[newDutyDoctor].nightShifts++

          hasAdjustment = true
        }
      }
    }

    if (hasAdjustment) {
      console.log('✅ 值班医生调整完成')
    }
  }

  /**
   * 分配白班（逐日处理，阶段化）
   */
  private assignDayShifts(
    dates: string[],
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    dutySchedule: Record<string, string>,
    availableDoctors: string[],
    doctorSchedule: Record<string, DoctorSchedule>,
    isDoctorOnLeave: (doctor: string, date: string) => boolean,
    getFixedAssignment: (doctor: string, date: string) => {
      morning: string | '休息' | '请假'
      afternoon: string | '休息' | '请假'
    } | null,
    departments: string[] // 🔴 CRITICAL: 添加科室列表参数
  ): void {
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

    // 🔴 CRITICAL: 逐日处理
    dates.forEach((date, dateIndex) => {
      console.log(`\n🔴🔴🔴 处理日期: ${date}`)

      // 判断是否是周末
      const dateObj = new Date(date)
      const dayOfWeek = dateObj.getDay()
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

      // 周末只排前4个科室，工作日排所有科室
      const departmentsForDay = isWeekend ? departments.slice(0, 4) : departments

      console.log(`🔴 ${date} 是否是周末: ${isWeekend}, 科室数量: ${departmentsForDay.length}`)

      // 🔴 CRITICAL: 优先处理值班医生
      const dutyDoctor = dutySchedule[date]
      if (dutyDoctor && !this.isAssigned(dutyDoctor, date, doctorSchedule)) {
        // 检查值班医生是否前一天值班（应该不会，因为值班医生第二天必须休息）
        if (this.isDutyYesterday(dutyDoctor, date, dutySchedule, dates, dateIndex)) {
          this.setRest(dutyDoctor, date, doctorSchedule)
          console.log(`${date} 值班医生 ${dutyDoctor} 前一天值班，设置休息`)
        } else {
          // 检查值班医生是否有固定排班
          const fixedAssignment = getFixedAssignment(dutyDoctor, date)
          if (fixedAssignment) {
            this.applyFixedSchedule(
              dutyDoctor,
              date,
              fixedAssignment,
              schedule,
              doctorSchedule,
              dutyDoctor,
              isWeekend,
              departmentsForDay
            )
            console.log(`${date} 值班医生 ${dutyDoctor} 应用固定排班`)
          } else {
            // 值班医生分配到第一个可用科室（上午和下午）
            this.assignDutyDoctor(dutyDoctor, date, schedule, doctorSchedule, departmentsForDay)
            console.log(`${date} 值班医生 ${dutyDoctor} 分配科室`)
          }
        }
      }

      // 🔴 CRITICAL: 设置前一天值班的医生休息
      availableDoctors.forEach(doctor => {
        if (doctor === dutyDoctor) return

        if (this.isDutyYesterday(doctor, date, dutySchedule, dates, dateIndex)) {
          // 🔴 CRITICAL: 前一天值班的医生上午休息，下午可以工作
          if (!doctorSchedule[doctor].shifts[date]) {
            doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
          }
          doctorSchedule[doctor].shifts[date].morning = 'off'
          if (!doctorSchedule[doctor].departmentsByDate[date]) {
            doctorSchedule[doctor].departmentsByDate[date] = { morning: '', afternoon: '' }
          }
          doctorSchedule[doctor].departmentsByDate[date].morning = ''
          console.log(`${date} ${doctor} 前一天值班，上午休息`)
        }
      })

      // 🔴 CRITICAL: 为其他医生应用固定排班
      availableDoctors.forEach(doctor => {
        if (doctor === dutyDoctor) return

        const fixedAssignment = getFixedAssignment(doctor, date)
        if (fixedAssignment) {
          this.applyFixedSchedule(
            doctor,
            date,
            fixedAssignment,
            schedule,
            doctorSchedule,
            dutyDoctor,
            isWeekend,
            departmentsForDay
          )
          console.log(`${date} ${doctor} 应用固定排班`)
        }
      })

      // 🔴 CRITICAL: 以科室为中心，为每个科室的上午和下午分配医生
      this.assignDepartmentsByShift(date, schedule, doctorSchedule, availableDoctors, departmentsForDay, dutySchedule, dates, dateIndex, doctorWorkDays, doctorDailyWork)

      // 验证当天状态一致性
      this.validateDayConsistency(date, schedule, doctorSchedule, availableDoctors, departmentsForDay, dutySchedule, dates)
    })

    // 计算上午班和下午班的天数
    this.calculateShiftDays(doctorSchedule, dates)

    console.log('🔴 白班分配完成')
  }

  /**
   * 以科室为中心，为每个科室分配一个医生（上午+下午）
   */
  private assignDepartmentsByShift(
    date: string,
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    doctorSchedule: Record<string, DoctorSchedule>,
    availableDoctors: string[],
    departmentsForDay: string[],
    dutySchedule: Record<string, string>,
    dates: string[],
    dateIndex: number,
    doctorWorkDays: Record<string, number>,
    doctorDailyWork: Record<string, Set<string>>
  ): void {
    // 🔴 CRITICAL: 为每个科室分配一个医生（上午+下午）
    for (const dept of departmentsForDay) {
      // 检查科室是否已分配
      const existingSlot = schedule[date][dept][0]
      if (existingSlot) {
        // 科室已分配，确保上午和下午都有
        if (!schedule[date][dept].find(s => s.shift === 'morning')) {
          this.setWork(existingSlot.doctor, date, dept, 'morning', schedule, doctorSchedule)
        }
        if (!schedule[date][dept].find(s => s.shift === 'afternoon')) {
          this.setWork(existingSlot.doctor, date, dept, 'afternoon', schedule, doctorSchedule)
        }
        continue
      }

      // 🔴 CRITICAL: 找到可用的医生（前一天值班的医生下午可用）
      const availableForDept = availableDoctors.filter(doctor => {
        // 排除前一天值班的医生的上午
        if (this.isDutyYesterday(doctor, date, dutySchedule, dates, dateIndex)) {
          // 如果医生前一天值班，只允许下午工作
          if (doctorSchedule[doctor]?.shifts[date]?.afternoon === 'work') {
            return false  // 下午已分配
          }
          // 上午已休息，下午可用
          return true
        }

        // 排除已分配的医生（上午或下午已分配）
        if (doctorSchedule[doctor]?.shifts[date]?.morning === 'work') return false
        if (doctorSchedule[doctor]?.shifts[date]?.afternoon === 'work') return false

        return true
      })

      if (availableForDept.length === 0) {
        console.log(`  ${date} ${dept} 没有可用医生`)
        continue
      }

      // 选择班次最少的医生（轮询分配）
      const selectedDoctor = this.selectDoctorByLeastShifts(availableForDept, doctorSchedule, dates, dateIndex)

      // 检查医生是否前一天值班
      const isDutyYesterday = this.isDutyYesterday(selectedDoctor, date, dutySchedule, dates, dateIndex)

      if (isDutyYesterday) {
        // 前一天值班的医生，只分配下午
        this.setWork(selectedDoctor, date, dept, 'afternoon', schedule, doctorSchedule)
        console.log(`  ${date} ${dept} 下午分配给 ${selectedDoctor}（前一天值班）`)
      } else {
        // 其他医生，分配全天（上午+下午）
        this.setFullDayWork(selectedDoctor, date, dept, schedule, doctorSchedule)
        console.log(`  ${date} ${dept} 分配给 ${selectedDoctor}`)
      }

      // 统计天数
      if (!doctorDailyWork[selectedDoctor].has(date)) {
        doctorDailyWork[selectedDoctor].add(date)
        doctorWorkDays[selectedDoctor]++
      }
    }
  }

  /**
   * 选择班次最少的医生
   */
  private selectDoctorByLeastShifts(
    availableDoctors: string[],
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[],
    dateIndex: number
  ): string {
    // 计算每个医生到当前日期为止的班次数（上午+下午）
    const doctorShifts: Record<string, number> = {}
    availableDoctors.forEach(doctor => {
      let totalShifts = 0
      for (let i = 0; i <= dateIndex; i++) {
        const date = dates[i]
        if (doctorSchedule[doctor]?.shifts[date]?.morning === 'work') totalShifts++
        if (doctorSchedule[doctor]?.shifts[date]?.afternoon === 'work') totalShifts++
      }
      doctorShifts[doctor] = totalShifts
    })

    // 选择班次最少的医生
    const sortedDoctors = availableDoctors.sort((a, b) => doctorShifts[a] - doctorShifts[b])
    return sortedDoctors[0]
  }

  /**
   * 应用固定排班
   */
  private applyFixedSchedule(
    doctor: string,
    date: string,
    fixedAssignment: {
      morning: string | '休息' | '请假'
      afternoon: string | '休息' | '请假'
    },
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    doctorSchedule: Record<string, DoctorSchedule>,
    dutyDoctor: string | undefined,
    isWeekend: boolean,
    departmentsForDay: string[]
  ): void {
    const { morning, afternoon } = fixedAssignment

    // 🔴 CRITICAL: 固定排班优先级最高，即使是值班医生也要应用
    // 如果是值班医生，仍然应用固定排班
    if (dutyDoctor === doctor) {
      console.log(`  ${date} ${doctor} 是值班医生，但仍然应用固定排班`)
    }

    // 如果包含"请假"，设置为休息
    if (morning === '请假' || afternoon === '请假') {
      if (!doctorSchedule[doctor].shifts[date]) {
        doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
      }
      if (morning === '请假') {
        doctorSchedule[doctor].shifts[date].morning = 'off'
      }
      if (afternoon === '请假') {
        doctorSchedule[doctor].shifts[date].afternoon = 'off'
      }
      doctorSchedule[doctor].departmentsByDate[date] = { morning: '', afternoon: '' }
      console.log(`  ${date} ${doctor} 固定排班设置为请假`)
      return
    }

    // 如果包含"休息"，设置为休息
    if (morning === '休息' || afternoon === '休息') {
      if (!doctorSchedule[doctor].shifts[date]) {
        doctorSchedule[doctor].shifts[date] = { morning: 'off', afternoon: 'off' }
      }
      if (morning === '休息') {
        doctorSchedule[doctor].shifts[date].morning = 'off'
      }
      if (afternoon === '休息') {
        doctorSchedule[doctor].shifts[date].afternoon = 'off'
      }
      doctorSchedule[doctor].departmentsByDate[date] = { morning: '', afternoon: '' }
      console.log(`  ${date} ${doctor} 固定排班设置为休息`)
      return
    }

    // 如果是科室，检查周末限制
    if (isWeekend) {
      const morningInvalid = !departmentsForDay.includes(morning)
      const afternoonInvalid = !departmentsForDay.includes(afternoon)

      if (morningInvalid || afternoonInvalid) {
        console.log(`  ${date} ${doctor} 固定排班不在周末前4个科室内，跳过`)
        return
      }
    }

    // 应用科室排班（morning 和 afternoon 都是科室名称）
    if (morning !== '休息' && morning !== '请假') {
      this.setWork(doctor, date, morning, 'morning', schedule, doctorSchedule)
      console.log(`  ${date} ${doctor} 固定排班设置为上午 ${morning}`)
    }

    if (afternoon !== '休息' && afternoon !== '请假') {
      this.setWork(doctor, date, afternoon, 'afternoon', schedule, doctorSchedule)
      console.log(`  ${date} ${doctor} 固定排班设置为下午 ${afternoon}`)
    }
  }

  /**
   * 分配值班医生到可用科室
   */
  private assignDutyDoctor(
    doctor: string,
    date: string,
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    doctorSchedule: Record<string, DoctorSchedule>,
    departmentsForDay: string[]
  ): void {
    // 🔴 CRITICAL: 找到上午和下午可用的科室
    const morningDepartment = departmentsForDay.find(dept => {
      const morningSlot = schedule[date][dept].find(s => s.shift === 'morning')
      return !morningSlot
    })

    const afternoonDepartment = departmentsForDay.find(dept => {
      const afternoonSlot = schedule[date][dept].find(s => s.shift === 'afternoon')
      return !afternoonSlot
    })

    if (!morningDepartment && !afternoonDepartment) {
      console.log(`  ${date} 所有班次都已被分配，跳过值班医生 ${doctor}`)
      return
    }

    // 分配值班医生到可用科室（上午和下午）
    if (morningDepartment) {
      this.setWork(doctor, date, morningDepartment, 'morning', schedule, doctorSchedule)
      console.log(`  ${date} 值班医生 ${doctor} 上午分配到 ${morningDepartment}`)
    }

    if (afternoonDepartment) {
      this.setWork(doctor, date, afternoonDepartment, 'afternoon', schedule, doctorSchedule)
      console.log(`  ${date} 值班医生 ${doctor} 下午分配到 ${afternoonDepartment}`)
    }
  }

  /**
   * 自动填充：为医生分配到可用科室
   */
  private autoFill(
    doctor: string,
    date: string,
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    doctorSchedule: Record<string, DoctorSchedule>,
    departmentsForDay: string[],
    doctorWorkDays: Record<string, number>,
    doctorDailyWork: Record<string, Set<string>>
  ): void {
    // 🔴 CRITICAL: 检查医生的上午是否已分配，如果没有，分配上午班次
    const shift = doctorSchedule[doctor]?.shifts[date] || { morning: 'off', afternoon: 'off' }

    if (shift.morning !== 'work') {
      // 找到上午可用的科室（上午没有被分配医生的科室）
      const availableMorningDepartment = departmentsForDay.find(dept => {
        const morningSlot = schedule[date][dept].find(s => s.shift === 'morning')
        return !morningSlot
      })

      if (availableMorningDepartment) {
        this.setWork(doctor, date, availableMorningDepartment, 'morning', schedule, doctorSchedule)
        console.log(`  ${date} 医生 ${doctor} 上午自动填充到 ${availableMorningDepartment}`)
      }
    }

    // 🔴 CRITICAL: 检查医生的下午是否已分配，如果没有，分配下午班次
    const shiftAfter = doctorSchedule[doctor]?.shifts[date] || { morning: 'off', afternoon: 'off' }

    if (shiftAfter.afternoon !== 'work') {
      // 找到下午可用的科室（下午没有被分配医生的科室）
      const availableAfternoonDepartment = departmentsForDay.find(dept => {
        const afternoonSlot = schedule[date][dept].find(s => s.shift === 'afternoon')
        return !afternoonSlot
      })

      if (availableAfternoonDepartment) {
        this.setWork(doctor, date, availableAfternoonDepartment, 'afternoon', schedule, doctorSchedule)
        console.log(`  ${date} 医生 ${doctor} 下午自动填充到 ${availableAfternoonDepartment}`)
      }
    }

    // 统计天数：如果这个医生今天还没排过班，则天数+1
    if (!doctorDailyWork[doctor].has(date)) {
      doctorDailyWork[doctor].add(date)
      doctorWorkDays[doctor]++
    }
  }

  /**
   * 验证当天状态一致性
   */
  private validateDayConsistency(
    date: string,
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    doctorSchedule: Record<string, DoctorSchedule>,
    availableDoctors: string[],
    departmentsForDay: string[],
    dutySchedule: Record<string, string>,
    dates: string[]
  ): void {
    // 验证1：每个科室的上午和下午各最多一个医生
    for (const dept of departmentsForDay) {
      const morningDoctors = schedule[date][dept].filter(s => s.shift === 'morning').map(s => s.doctor)
      const afternoonDoctors = schedule[date][dept].filter(s => s.shift === 'afternoon').map(s => s.doctor)

      const uniqueMorningDoctors = new Set(morningDoctors)
      const uniqueAfternoonDoctors = new Set(afternoonDoctors)

      if (uniqueMorningDoctors.size > 1) {
        throw new Error(`${date} ${dept} 上午有多个医生：${Array.from(uniqueMorningDoctors).join(', ')}`)
      }

      if (uniqueAfternoonDoctors.size > 1) {
        throw new Error(`${date} ${dept} 下午有多个医生：${Array.from(uniqueAfternoonDoctors).join(', ')}`)
      }
    }

    // 🔴 CRITICAL: 验证2：值班医生必须有白班（除非前一天值班，第二天必须休息）
    const dutyDoctor = dutySchedule[date]
    if (dutyDoctor) {
      const dateIndex = dates.indexOf(date)
      const isDutyYesterday = dateIndex > 0 && dutySchedule[dates[dateIndex - 1]] === dutyDoctor

      // 如果值班医生前一天值班，第二天必须休息，不需要白班
      if (!isDutyYesterday) {
        const shift = doctorSchedule[dutyDoctor]?.shifts[date]
        if (!shift || (shift.morning !== 'work' && shift.afternoon !== 'work')) {
          throw new Error(`${date} 值班医生 ${dutyDoctor} 没有白班`)
        }
      } else {
        console.log(`  ${date} 值班医生 ${dutyDoctor} 前一天值班，第二天必须休息，跳过白班验证`)
      }
    }

    // 验证3：前一天值班的医生今天不能上午工作，但可以下午工作
    const dateIndex = dates.indexOf(date)
    if (dateIndex > 0) {
      const yesterday = dates[dateIndex - 1]
      const yesterdayDutyDoctor = dutySchedule[yesterday]
      if (yesterdayDutyDoctor) {
        const shift = doctorSchedule[yesterdayDutyDoctor]?.shifts[date]
        if (shift && shift.morning === 'work') {
          throw new Error(`${date} 前一天值班医生 ${yesterdayDutyDoctor} 不能上午工作`)
        }
      }
    }

    console.log(`✅ ${date} 验证通过`)
  }

  /**
   * 计算上午班和下午班的天数
   */
  private calculateShiftDays(
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[]
  ): void {
    Object.values(doctorSchedule).forEach(info => {
      // 统计上午班天数（排除值班当天）
      const morningDays = new Set<string>()
      dates.forEach(date => {
        if (info.shifts[date]?.morning === 'work' && !info.nightShiftsByDate[date]) {
          morningDays.add(date)
        }
      })
      info.morningShiftDays = morningDays.size

      // 统计下午班天数（下午班和上午班同一天，排除值班当天）
      const afternoonDays = new Set<string>()
      dates.forEach(date => {
        if (info.shifts[date]?.afternoon === 'work' && !info.nightShiftsByDate[date]) {
          afternoonDays.add(date)
        }
      })
      info.afternoonShiftDays = afternoonDays.size
    })
  }

  /**
   * 验证休息天数
   */
  private validateRestDays(
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[],
    availableDoctors: string[]
  ): string[] {
    const failedDoctors: string[] = []

    // 只验证可用医生（不包括请假医生）
    availableDoctors.forEach(doctorName => {
      const info = doctorSchedule[doctorName]
      if (!info) return

      // 🔴 CRITICAL: 计算半天休息天数（上午或下午有一个是 'off' 就算半天休息）
      const halfRestDays = dates.filter(date =>
        info.shifts[date] &&
        (info.shifts[date].morning === 'off' || info.shifts[date].afternoon === 'off')
      ).length

      // 计算全天休息天数（上午和下午都是 'off'）
      const fullRestDays = dates.filter(date =>
        info.shifts[date] &&
        info.shifts[date].morning === 'off' &&
        info.shifts[date].afternoon === 'off'
      ).length

      console.log(`${info.name}: 全天休息天数=${fullRestDays}, 半天休息天数=${halfRestDays}`)

      // 🔴 CRITICAL: 检查是否有至少 0.5 天的休息（半天休息也算）
      if (halfRestDays < 0.5) {
        failedDoctors.push(info.name)
      }
    })

    return failedDoctors
  }

  /**
   * 计算休息天数
   */
  private calculateRestDays(
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[]
  ): void {
    Object.values(doctorSchedule).forEach(info => {
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
   * 生成日期列表（从开始日期开始，共7天）
   */
  private getDates(startDate: string, days: number): string[] {
    const dates: string[] = []
    const start = new Date(startDate)

    for (let i = 0; i < days; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      dates.push(this.formatDate(date))
    }

    return dates
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 获取带星期的日期字符串
   */
  private getDateWithWeek(date: string): string {
    const dateObj = new Date(date)
    const dayOfWeek = dateObj.getDay()
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${date} ${dayNames[dayOfWeek]}`
  }

  /**
   * 生成 Word 文档
   */
  async generateWordDocument(scheduleData: ScheduleData): Promise<Buffer> {
    const { dates, datesWithWeek, departments, schedule, dutySchedule } = scheduleData

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: '排班表',
              heading: 'Heading1',
              alignment: 'center',
              spacing: {
                after: 400,
              },
            }),

            // 值班表
            new Paragraph({
              text: '值班表',
              heading: 'Heading2',
              spacing: {
                before: 400,
                after: 200,
              },
            }),
            ...this.createDutyTable(datesWithWeek, dutySchedule),

            // 科室排班表
            new Paragraph({
              text: '科室排班表',
              heading: 'Heading2',
              spacing: {
                before: 400,
                after: 200,
              },
            }),
            ...this.createDepartmentTable(datesWithWeek, departments, schedule),
          ],
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    return buffer
  }

  /**
   * 创建值班表
   */
  private createDutyTable(datesWithWeek: string[], dutySchedule: Record<string, string>): Paragraph[] {
    const rows: TableRow[] = []

    // 表头
    const headerCells = [
      new TableCell({
        children: [new Paragraph({ text: '日期', alignment: 'center' })],
        width: { size: 40, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ text: '值班医生', alignment: 'center' })],
        width: { size: 60, type: WidthType.PERCENTAGE },
      }),
    ]
    rows.push(new TableRow({ children: headerCells, tableHeader: true }))

    // 数据行
    datesWithWeek.forEach(dateWithWeek => {
      const date = dateWithWeek.split(' ')[0]
      const dutyDoctor = dutySchedule[date] || ''

      const cells = [
        new TableCell({
          children: [new Paragraph({ text: dateWithWeek, alignment: 'center' })],
          width: { size: 40, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ text: dutyDoctor, alignment: 'center' })],
          width: { size: 60, type: WidthType.PERCENTAGE },
        }),
      ]
      rows.push(new TableRow({ children: cells }))
    })

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left: { style: BorderStyle.SINGLE, size: 1 },
        right: { style: BorderStyle.SINGLE, size: 1 },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
        insideVertical: { style: BorderStyle.SINGLE, size: 1 },
      },
    })

    return [new Paragraph({ children: [table] })]
  }

  /**
   * 创建科室排班表
   */
  private createDepartmentTable(
    datesWithWeek: string[],
    departments: string[],
    schedule: Record<string, Record<string, ScheduleSlot[]>>
  ): Paragraph[] {
    const rows: TableRow[] = []

    // 表头
    const headerCells = [
      new TableCell({
        children: [new Paragraph({ text: '日期', alignment: 'center' })],
        width: { size: 15, type: WidthType.PERCENTAGE },
      }),
      ...departments.map(dept =>
        new TableCell({
          children: [new Paragraph({ text: dept, alignment: 'center' })],
          width: { size: 85 / departments.length, type: WidthType.PERCENTAGE },
        })
      ),
    ]
    rows.push(new TableRow({ children: headerCells, tableHeader: true }))

    // 数据行
    datesWithWeek.forEach(dateWithWeek => {
      const date = dateWithWeek.split(' ')[0]

      const cells = [
        new TableCell({
          children: [new Paragraph({ text: dateWithWeek, alignment: 'center' })],
          width: { size: 15, type: WidthType.PERCENTAGE },
        }),
        ...departments.map(dept => {
          const slots = schedule[date]?.[dept] || []
          const doctors = slots
            .filter(slot => slot.shift === 'morning')
            .map(slot => slot.doctor)
            .join('、')

          return new TableCell({
            children: [new Paragraph({ text: doctors || '', alignment: 'center' })],
            width: { size: 85 / departments.length, type: WidthType.PERCENTAGE },
          })
        }),
      ]
      rows.push(new TableRow({ children: cells }))
    })

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left: { style: BorderStyle.SINGLE, size: 1 },
        right: { style: BorderStyle.SINGLE, size: 1 },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
        insideVertical: { style: BorderStyle.SINGLE, size: 1 },
      },
    })

    return [new Paragraph({ children: [table] })]
  }
}
