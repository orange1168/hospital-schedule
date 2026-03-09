import { Injectable, BadRequestException } from '@nestjs/common'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun, HeadingLevel, AlignmentType } from 'docx'

// 固定的医生列表（18人，排除邓旦）
const FIXED_DOCTORS = [
  '杨波', '李丹', '黄丹', '李茜', '陈晓林', '高玲', '曹钰', '朱朝霞', '范冬黎',
  '周晓宇', '彭粤如', '万佳乐', '姜维', '罗丹', '杨飞娇', '蓝觅', '李卓', '蔡忠凤'
]

// 固定排班接口（支持半天班次）
export interface FixedSchedule {
  [date: string]: {
    [doctorName: string]: {
      morning: string  // 科室名称、'休息'、'请假'、'请输入'
      afternoon: string
    }
  }
}

// 选中的科室（每天）
export interface SelectedDepartments {
  Monday: string[]
  Tuesday: string[]
  Wednesday: string[]
  Thursday: string[]
  Friday: string[]
  Saturday: string[]
  Sunday: string[]
}

// 医生类
class Doctor {
  id: number
  name: string
  isDutyDoctor: boolean
  dutyDate: string | null
  requiredRestDate: string | null
  schedule: Record<string, { morning: string; afternoon: string }>
  workDays: number
  restDays: number
  consecutiveWorkDays: number

  constructor(name: string, id: number) {
    this.id = id
    this.name = name
    this.isDutyDoctor = false
    this.dutyDate = null
    this.requiredRestDate = null
    this.schedule = {}
    this.workDays = 0
    this.restDays = 0
    this.consecutiveWorkDays = 0
  }

  /**
   * 检查是否是全天工作
   */
  isFullDayWork(dayName: string): boolean {
    const schedule = this.schedule[dayName]
    return schedule?.morning !== '' &&
           schedule?.morning !== '休息' &&
           schedule?.morning !== '请假' &&
           schedule?.afternoon !== '' &&
           schedule?.afternoon !== '休息' &&
           schedule?.afternoon !== '请假'
  }

  /**
   * 检查是否全天休息
   */
  isFullDayRest(dayName: string): boolean {
    const schedule = this.schedule[dayName]
    return (schedule?.morning === '休息' || schedule?.morning === '请假') &&
           (schedule?.afternoon === '休息' || schedule?.afternoon === '请假')
  }
}

// 天类
class Day {
  date: string
  dayOfWeek: string
  dutyDoctor: string | null
  departmentPool: string[]  // 科室池：["1诊室", "2诊室", ...]
  doctorPool: string[]      // 医生池：["李茜", "姜维", ...]

  constructor(date: string, dayOfWeek: string) {
    this.date = date
    this.dayOfWeek = dayOfWeek
    this.dutyDoctor = null
    this.departmentPool = []
    this.doctorPool = []
  }

  /**
   * 初始化科室池
   */
  initDepartmentPool(departmentNames: string[]): void {
    this.departmentPool = [...departmentNames]
  }

  /**
   * 初始化医生池
   */
  initDoctorPool(doctorNames: string[]): void {
    this.doctorPool = [...doctorNames]
  }

  /**
   * 从科室池中随机选择一个科室
   */
  randomDepartment(): string | null {
    if (this.departmentPool.length === 0) {
      return null
    }
    const randomIndex = Math.floor(Math.random() * this.departmentPool.length)
    return this.departmentPool[randomIndex]
  }

  /**
   * 从科室池中移除科室
   */
  removeDepartment(department: string): void {
    const index = this.departmentPool.indexOf(department)
    if (index !== -1) {
      this.departmentPool.splice(index, 1)
    }
  }

  /**
   * 从医生池中随机选择一个医生
   */
  randomDoctor(): string | null {
    if (this.doctorPool.length === 0) {
      return null
    }
    const randomIndex = Math.floor(Math.random() * this.doctorPool.length)
    return this.doctorPool[randomIndex]
  }

  /**
   * 从医生池中移除医生
   */
  removeDoctor(doctorName: string): void {
    const index = this.doctorPool.indexOf(doctorName)
    if (index !== -1) {
      this.doctorPool.splice(index, 1)
    }
  }
}

// 排班槽位
interface ScheduleSlot {
  doctor: string
  shift: 'morning' | 'afternoon' | 'night' | 'off'
  department?: string
}

// 医生排班信息
interface DoctorSchedule {
  name: string
  shifts: Record<string, { morning: 'work' | 'off'; afternoon: 'work' | 'off' }>
  nightShiftsByDate: Record<string, boolean>
  departmentsByDate: Record<string, { morning: string; afternoon: string }>
  morningShifts: string[]
  afternoonShifts: string[]
  morningShiftDays: number
  afternoonShiftDays: number
  nightShifts: number
  restDays: number
  isSpecialRow?: boolean // 标记是否为特殊行（一线夜、二线夜、三线夜、补休、其他）
}

// 排班数据
export interface ScheduleData {
  dates: string[]
  datesWithWeek: string[]
  departments: string[]
  schedule: Record<string, Record<string, ScheduleSlot[]>>
  dutySchedule: Record<string, string>
  doctorSchedule: Record<string, DoctorSchedule>
  useHalfDay: boolean
}

@Injectable()
export class ScheduleService {
  private readonly departments = [
    '1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '9诊室', '10诊室',
    '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男1', '男2', '男3', '女1', '女2', '女3'
  ]

  /**
   * 生成排班表（主入口）
   */
  async generateSchedule(
    startDate: string,
    dutyDoctors: string[],
    selectedDepartments: SelectedDepartments,
    fixedSchedule?: FixedSchedule,
    leaveDoctors?: string[] | { doctor: string; dates: string[] }[],
    endDate?: string // 🔴 新增：结束日期（可选，默认7天）
  ): Promise<ScheduleData> {
    console.log('🔴 ===== 开始生成排班表 =====')
    console.log('🔴 起始日期:', startDate)
    console.log('🔴 结束日期:', endDate || '未提供（默认7天）')
    console.log('🔴 值班医生列表:', dutyDoctors)
    console.log('🔴 选中的科室:', selectedDepartments)

    // === 第一阶段：获取页面数据 ===
    console.log('\n🔴 ===== 第一阶段：获取页面数据 =====')

    // 🔴 修改：根据endDate计算天数，支持动态天数（最多14天）
    let scheduleDays = 7 // 默认7天
    if (endDate) {
      const start = new Date(startDate)
      const end = new Date(endDate)
      const diffTime = end.getTime() - start.getTime()
      scheduleDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
      // 限制最大14天
      scheduleDays = Math.min(scheduleDays, 14)
    }

    console.log('🔴 排班天数:', scheduleDays)

    // 获取日期列表
    const dates = this.getDates(startDate, scheduleDays)
    const dayNames = dates.map(date => this.getDayName(date))
    const datesWithWeek = dates.map(date => `${date} ${this.getDayOfWeek(date)}`)

    console.log('🔴 日期列表:', dates)
    console.log('🔴 星期列表:', dayNames)

    // 验证输入数据
    this.validateInput(dutyDoctors, selectedDepartments, scheduleDays)

    // 处理请假数据
    const leaveMap = this.processLeaveDoctors(leaveDoctors)
    console.log('🔴 请假医生:', leaveMap)

    // === 第二阶段：实例化医生并初始化 ===
    console.log('\n🔴 ===== 第二阶段：实例化医生并初始化 =====')

    // 实例化18个医生
    const doctors = FIXED_DOCTORS.map((name, id) => new Doctor(name, id))

    // 初始化医生排班表
    doctors.forEach(doctor => {
      dayNames.forEach(dayName => {
        doctor.schedule[dayName] = { morning: '', afternoon: '' }
      })
    })

    console.log('🔴 实例化18个医生完成')

    // 初始化7个天
    const days = dayNames.map((dayName, index) => new Day(dates[index], dayName))
    days.forEach(day => {
      day.initDepartmentPool(selectedDepartments[day.dayOfWeek as keyof SelectedDepartments] || [])
    })

    console.log('🔴 初始化7个天完成')

    // 生成值班医生表
    const dutySchedule = this.generateDutySchedule(
      doctors,
      dutyDoctors,
      dates,
      dayNames,
      leaveMap,
      fixedSchedule
    )

    console.log('🔴 值班医生表:', dutySchedule)

    // 处理用户固定排班
    this.processFixedSchedule(
      doctors,
      days,
      fixedSchedule,
      leaveMap
    )

    console.log('🔴 用户固定排班处理完成')

    // === 第三阶段：系统排班（按天进行） ===
    console.log('\n🔴 ===== 第三阶段：系统排班（按天进行） =====')

    this.scheduleByDay(
      doctors,
      days,
      dutySchedule,
      leaveMap,
      dates,
      dayNames
    )

    // 转换为旧的数据结构（保持兼容）
    return this.convertToLegacyFormat(
      doctors,
      dates,
      datesWithWeek,
      selectedDepartments,
      dutySchedule
    )
  }

  /**
   * 生成值班医生表
   */
  private generateDutySchedule(
    doctors: Doctor[],
    dutyDoctors: string[],
    dates: string[],
    dayNames: string[],
    leaveMap: Record<string, string[]>,
    fixedSchedule?: FixedSchedule
  ): Record<string, string> {
    const dutySchedule: Record<string, string> = {}

    // 🔴 修改：记录每个医生不能值班的剩余天数（确保至少休息1天）
    const doctorDutyBlockDays: Record<string, number> = {}

    // 初始化所有医生的禁止值班天数为0
    doctors.forEach(doctor => {
      doctorDutyBlockDays[doctor.name] = 0
    })

    dates.forEach((date, index) => {
      const dayName = dayNames[index]

      // 🔴 修改：递减所有医生的禁止值班天数
      Object.keys(doctorDutyBlockDays).forEach(doctorName => {
        if (doctorDutyBlockDays[doctorName] > 0) {
          doctorDutyBlockDays[doctorName]--
        }
      })

      // 🔴 修改：从用户选择的值班医生列表中循环选择，但要跳过不能值班的医生
      let dutyDoctorName: string | null = null
      let dutyDoctor: Doctor | null = null

      // 尝试找到一个可以值班的医生
      for (let attempt = 0; attempt < dutyDoctors.length; attempt++) {
        const candidateDoctorName = dutyDoctors[(index + attempt) % dutyDoctors.length]
        const candidateDoctor = doctors.find(d => d.name === candidateDoctorName)

        if (!candidateDoctor) {
          console.error(`🔴 错误：找不到医生 ${candidateDoctorName}`)
          continue
        }

        // 检查是否可以值班
        const canDuty = this.checkCanDuty(
          candidateDoctor,
          date,
          dayName,
          leaveMap,
          fixedSchedule,
          doctorDutyBlockDays
        )

        if (canDuty) {
          dutyDoctorName = candidateDoctorName
          dutyDoctor = candidateDoctor
          break
        }
      }

      if (!dutyDoctor || !dutyDoctorName) {
        console.error(`🔴 错误：无法为 ${date} (${dayName}) 找到合适的值班医生`)
        dutySchedule[date] = '无法值班'
        return
      }

      dutySchedule[date] = dutyDoctor.name
      dutyDoctor.isDutyDoctor = true
      dutyDoctor.dutyDate = date

      // 🔴 修改：设置该医生不能值班的剩余天数为1（第二天必须休息）
      doctorDutyBlockDays[dutyDoctor.name] = 1

      // 🔴 修改：设置值班休息日（用于后续处理固定排班）
      if (index + 1 < dates.length) {
        dutyDoctor.requiredRestDate = dates[index + 1]
        console.log(`  🔴 设置 ${dutyDoctor.name} 的值班休息日为 ${dates[index + 1]}`)
      }

      console.log(`🔴 ${date} (${dayName}) 值班医生: ${dutyDoctor.name}`)
    })

    return dutySchedule
  }

  /**
   * 检查医生是否可以值班
   */
  private checkCanDuty(
    doctor: Doctor,
    date: string,
    dayName: string,
    leaveMap: Record<string, string[]>,
    fixedSchedule?: FixedSchedule,
    doctorDutyBlockDays?: Record<string, number>
  ): boolean {
    // 检查是否请假
    if (leaveMap[doctor.name] && (leaveMap[doctor.name].length === 0 || leaveMap[doctor.name].includes(date))) {
      return false
    }

    // 检查是否处于值班休息期
    if (doctorDutyBlockDays && doctorDutyBlockDays[doctor.name] > 0) {
      return false
    }

    // 检查固定排班是否为"休息"或"请假"
    if (fixedSchedule && fixedSchedule[date] && fixedSchedule[date][doctor.name]) {
      const { morning, afternoon } = fixedSchedule[date][doctor.name]
      if (morning === '休息' || morning === '请假' || afternoon === '休息' || afternoon === '请假') {
        return false
      }
    }

    return true
  }

  /**
   * 处理用户固定排班
   */
  private processFixedSchedule(
    doctors: Doctor[],
    days: Day[],
    fixedSchedule?: FixedSchedule,
    leaveMap?: Record<string, string[]>
  ): void {
    if (!fixedSchedule) {
      console.log('🔴 没有固定排班，跳过处理')
      return
    }

    days.forEach(day => {
      const dayAssignments = fixedSchedule[day.date]

      if (!dayAssignments) return

      Object.entries(dayAssignments).forEach(([doctorName, shift]) => {
        const doctor = doctors.find(d => d.name === doctorName)
        if (!doctor) return

        // 🔴 检查是否是值班休息日（优先级最高）
        if (doctor.requiredRestDate === day.date) {
          console.log(`  ⚠️ 固定排班冲突：${doctorName} ${day.date} 是值班休息日，忽略固定排班，强制休息`)
          doctor.schedule[day.dayOfWeek] = { morning: '休息', afternoon: '休息' }
          doctor.restDays++
          return
        }

        const { morning, afternoon } = shift

        // 处理上午
        if (morning !== '请输入') {
          if (morning === '休息' || morning === '请假') {
            doctor.schedule[day.dayOfWeek].morning = morning
          } else {
            // 从科室池中移除该科室
            day.removeDepartment(morning)
            doctor.schedule[day.dayOfWeek].morning = morning
            doctor.workDays++
            console.log(`  ✅ 固定排班：${doctorName} ${day.date} 上午 ${morning}`)
          }
        }

        // 处理下午
        if (afternoon !== '请输入') {
          if (afternoon === '休息' || afternoon === '请假') {
            doctor.schedule[day.dayOfWeek].afternoon = afternoon
          } else {
            // 从科室池中移除该科室
            day.removeDepartment(afternoon)
            doctor.schedule[day.dayOfWeek].afternoon = afternoon
            doctor.workDays++
            console.log(`  ✅ 固定排班：${doctorName} ${day.date} 下午 ${afternoon}`)
          }
        }
      })
    })

    console.log('🔴 固定排班处理完成')
  }

  /**
   * 按天排班（核心逻辑）
   */
  private scheduleByDay(
    doctors: Doctor[],
    days: Day[],
    dutySchedule: Record<string, string>,
    leaveMap: Record<string, string[]>,
    dates: string[],
    dayNames: string[]
  ): void {
    days.forEach((day, index) => {
      console.log(`\n🔴 ===== ${day.date} (${day.dayOfWeek}) 排班 =====`)
      console.log(`  📊 初始科室池: [${day.departmentPool.join(', ')}]`)

      // Step 1: 值班医生固定分配到1诊室
      const dutyDoctorName = dutySchedule[day.date]
      console.log(`  📊 Step 1 开始：值班医生 = ${dutyDoctorName}`)
      if (dutyDoctorName) {
        const dutyDoctor = doctors.find(d => d.name === dutyDoctorName)
        if (dutyDoctor) {
          console.log(`  📊 值班医生对象: ${dutyDoctor.name}, id=${dutyDoctor.id}`)
          console.log(`  📊 科室池大小: ${day.departmentPool.length}, 内容: [${day.departmentPool.join(', ')}]`)

          // 🔴 修改：值班医生固定分配到1诊室
          const selectedDept = '1诊室'

          // 检查科室池中是否有1诊室
          const hasOneClinic = day.departmentPool.includes('1诊室')
          if (hasOneClinic) {
            // 从科室池中移除1诊室
            day.removeDepartment('1诊室')
          }

          // 设置值班医生
          dutyDoctor.schedule[day.dayOfWeek] = { morning: selectedDept, afternoon: selectedDept }
          dutyDoctor.workDays++
          dutyDoctor.consecutiveWorkDays++
          console.log(`  ✅ 值班医生 ${dutyDoctorName} 固定分配到 ${selectedDept}（全天）`)
          console.log(`  📊 剩余科室池: [${day.departmentPool.join(', ')}]`)
        }
      }

      // Step 2: 初始化医生池（筛选可用医生）
      const availableDoctors = doctors.filter(doctor => {
        // 移除请假的医生
        if (leaveMap[doctor.name] && (leaveMap[doctor.name].length === 0 || leaveMap[doctor.name].includes(day.date))) {
          return false
        }
        // 🔴 修改：移除值班休息日的医生（优先级最高）
        if (doctor.requiredRestDate === day.date) {
          console.log(`  🔴 ${doctor.name} 今天是值班休息日，移出医生池`)
          return false
        }
        // 移除值班医生（已分配科室）
        if (doctor.dutyDate === day.date) {
          return false
        }
        // 移除已有固定排班的医生
        if (doctor.schedule[day.dayOfWeek].morning !== '' ||
            doctor.schedule[day.dayOfWeek].afternoon !== '') {
          return false
        }
        return true
      })

      day.initDoctorPool(availableDoctors.map(d => d.name))
      console.log(`  📊 医生池: [${day.doctorPool.join(', ')}]`)

      // Step 3: 科室选医生（从第一个科室到最后一个）
      while (day.departmentPool.length > 0 && day.doctorPool.length > 0) {
        // 从科室池中随机选择一个科室
        const dept = day.randomDepartment()
        if (!dept) break

        // 选择医生（包含第三天和第六天的特殊规则）
        const doctorName = this.selectDoctor(day.doctorPool, day.dayOfWeek, index, doctors, dates, dayNames)
        if (!doctorName) break

        // 从科室池中移除该科室
        day.removeDepartment(dept)
        // 从医生池中移除该医生
        day.removeDoctor(doctorName)

        // 设置医生
        const doctor = doctors.find(d => d.name === doctorName)
        if (doctor) {
          doctor.schedule[day.dayOfWeek] = { morning: dept, afternoon: dept }
          doctor.workDays++
          doctor.consecutiveWorkDays++
          console.log(`  ✅ ${dept} 分配给 ${doctorName}（全天）`)
        }

        console.log(`  📊 剩余科室池: [${day.departmentPool.join(', ')}]`)
        console.log(`  📊 剩余医生池: [${day.doctorPool.join(', ')}]`)
      }

      // Step 4: 剩余医生赋值"休息"
      day.doctorPool.forEach(doctorName => {
        const doctor = doctors.find(d => d.name === doctorName)
        if (doctor) {
          doctor.schedule[day.dayOfWeek] = { morning: '休息', afternoon: '休息' }
          doctor.restDays++
          doctor.consecutiveWorkDays = 0
          console.log(`  ✅ ${doctorName} 休息`)
        }
      })

      // Step 5: 为所有空位的医生赋值"休息"（包括值班医生分配失败的情况）
      doctors.forEach(doctor => {
        const schedule = doctor.schedule[day.dayOfWeek]
        if (schedule.morning === '') {
          schedule.morning = '休息'
          console.log(`  ✅ ${doctor.name} 上午空位赋值休息`)
        }
        if (schedule.afternoon === '') {
          schedule.afternoon = '休息'
          console.log(`  ✅ ${doctor.name} 下午空位赋值休息`)
        }
      })

      console.log(`🔴 ===== ${day.date} (${day.dayOfWeek}) 排班完成 =====`)
    })

    // 打印所有医生的排班表
    console.log('\n🔴 ===== 医生排班表 =====')
    doctors.forEach(doctor => {
      console.log(`  ${doctor.name}:`)
      dayNames.forEach(dayName => {
        const schedule = doctor.schedule[dayName]
        console.log(`    ${dayName}: ${JSON.stringify(schedule)}`)
      })
    })
    console.log('🔴 ===== 医生排班表结束 =====')
  }

  /**
   * 选择医生（包含第三天和第六天的特殊规则）
   */
  private selectDoctor(
    doctorPool: string[],
    dayName: string,
    dayIndex: number,
    allDoctors: Doctor[],
    dates: string[],
    dayNames: string[]
  ): string | null {
    // 第三天（索引2）开始：优先排休息够了2天的医生
    if (dayIndex >= 2) {
      const restedDoctors = doctorPool.filter(doctorName => {
        const doctor = allDoctors.find(d => d.name === doctorName)
        if (!doctor) return false

        // 检查前两天是否都休息
        const day1 = dayNames[dayIndex - 2]
        const day2 = dayNames[dayIndex - 1]
        return doctor.isFullDayRest(day1) && doctor.isFullDayRest(day2)
      })

      if (restedDoctors.length > 0) {
        console.log(`  🔍 优先选择休息够2天的医生: ${restedDoctors.join(', ')}`)
        return restedDoctors[Math.floor(Math.random() * restedDoctors.length)]
      }
    }

    // 第六天（索引5）开始：检查连续工作5天
    if (dayIndex >= 5) {
      const doctorsToRest = doctorPool.filter(doctorName => {
        const doctor = allDoctors.find(d => d.name === doctorName)
        if (!doctor) return false
        return doctor.consecutiveWorkDays >= 5
      })

      if (doctorsToRest.length > 0) {
        console.log(`  🔍 连续工作5天的医生，优先休息: ${doctorsToRest.join(', ')}`)
        // 从医生池中移除这些医生
        doctorsToRest.forEach(d => {
          const idx = doctorPool.indexOf(d)
          if (idx !== -1) {
            doctorPool.splice(idx, 1)
          }
        })
      }
    }

    // 随机选择一个医生
    if (doctorPool.length > 0) {
      return doctorPool[Math.floor(Math.random() * doctorPool.length)]
    }

    return null
  }

  /**
   * 验证输入数据
   */
  private validateInput(
    dutyDoctors: string[],
    selectedDepartments: SelectedDepartments,
    scheduleDays: number // 🔴 新增：排班天数
  ): void {
    if (!dutyDoctors || dutyDoctors.length === 0) {
      throw new BadRequestException('请至少选择一位值班医生')
    }

    // 🔴 修改：移除值班医生数量必须≥排班天数的限制
    // 改为验证值班医生数量至少7位（值班医生第二天必须休息）
    // 实际值班逻辑会在 generateDutySchedule 中处理循环分配
    if (dutyDoctors.length < 7) {
      throw new BadRequestException('请至少选择7位值班医生')
    }

    // 验证值班医生是否都在固定医生列表中
    dutyDoctors.forEach(doctor => {
      if (!FIXED_DOCTORS.includes(doctor)) {
        throw new BadRequestException(`值班医生"${doctor}"不存在`)
      }
    })

    const days: (keyof SelectedDepartments)[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    days.forEach(day => {
      if (!selectedDepartments[day] || selectedDepartments[day].length < 4) {
        throw new BadRequestException(`${day}至少需要选择4个科室，当前选择了${selectedDepartments[day]?.length || 0}个`)
      }
    })

    console.log('✅ 输入数据验证通过')
  }

  /**
   * 处理请假医生
   */
  private processLeaveDoctors(
    leaveDoctors?: string[] | { doctor: string; dates: string[] }[]
  ): Record<string, string[]> {
    const leaveMap: Record<string, string[]> = {}

    if (!leaveDoctors) {
      return leaveMap
    }

    if (Array.isArray(leaveDoctors) && leaveDoctors.length > 0) {
      const firstItem = leaveDoctors[0]

      if (typeof firstItem === 'string') {
        (leaveDoctors as string[]).forEach((doctor: string) => {
          leaveMap[doctor] = []
        })
      } else {
        (leaveDoctors as { doctor: string; dates: string[] }[]).forEach((item) => {
          leaveMap[item.doctor] = item.dates
        })
      }
    }

    return leaveMap
  }

  /**
   * 转换为旧的数据结构（保持兼容）
   */
  private convertToLegacyFormat(
    doctors: Doctor[],
    dates: string[],
    datesWithWeek: string[],
    selectedDepartments: SelectedDepartments,
    dutySchedule: Record<string, string>
  ): ScheduleData {
    // 🔴 从 selectedDepartments 中提取所有唯一的科室名称
    const allDepartments = new Set<string>()
    Object.values(selectedDepartments).forEach(dayDepts => {
      dayDepts.forEach(dept => allDepartments.add(dept))
    })
    const departments = Array.from(allDepartments)

    // 🔴 强制添加 1诊室（值班科室），即使它不在 selectedDepartments 中
    if (!departments.includes('1诊室')) {
      departments.push('1诊室')
    }

    console.log('🔴 所有科室:', departments)

    const schedule: Record<string, Record<string, ScheduleSlot[]>> = {}
    dates.forEach(date => {
      schedule[date] = {}
      departments.forEach(dept => {
        schedule[date][dept] = []
      })
    })

    const doctorSchedule: Record<string, DoctorSchedule> = {}

    doctors.forEach(doctor => {
      doctorSchedule[doctor.name] = {
        name: doctor.name,
        shifts: {},
        nightShiftsByDate: {},
        departmentsByDate: {},
        morningShifts: [],
        afternoonShifts: [],
        morningShiftDays: 0,
        afternoonShiftDays: 0,
        nightShifts: doctor.isDutyDoctor ? 1 : 0,
        restDays: doctor.restDays
      }

      dates.forEach(date => {
        const dayName = this.getDayName(date)
        const shift = doctor.schedule[dayName]

        // 🔴 初始化 departmentsByDate[date]，确保所有医生的所有日期都有完整数据
        if (!doctorSchedule[doctor.name].departmentsByDate[date]) {
          doctorSchedule[doctor.name].departmentsByDate[date] = {
            morning: '休息',
            afternoon: '休息'
          }
        }

        // 设置shifts
        if (shift.morning === '休息' || shift.morning === '请假') {
          doctorSchedule[doctor.name].shifts[date] = {
            morning: 'off',
            afternoon: shift.afternoon === '休息' || shift.afternoon === '请假' ? 'off' : 'work'
          }
          // 🔴 设置 departmentsByDate
          doctorSchedule[doctor.name].departmentsByDate[date].morning = shift.morning
        } else if (shift.morning !== '') {
          doctorSchedule[doctor.name].shifts[date] = {
            morning: 'work',
            afternoon: shift.afternoon === '休息' || shift.afternoon === '请假' ? 'off' : 'work'
          }
          // 🔴 设置 departmentsByDate
          doctorSchedule[doctor.name].departmentsByDate[date].morning = shift.morning
          doctorSchedule[doctor.name].morningShifts.push(shift.morning)
        } else {
          // 🔴 shift.morning 是空字符串，设置为 "休息"
          doctorSchedule[doctor.name].shifts[date] = {
            morning: 'off',
            afternoon: shift.afternoon === '休息' || shift.afternoon === '请假' ? 'off' : 'work'
          }
          // departmentsByDate[date].morning 已经在初始化时设置为 "休息"
        }

        // 🔴 处理下午
        if (shift.afternoon === '休息' || shift.afternoon === '请假') {
          doctorSchedule[doctor.name].departmentsByDate[date].afternoon = shift.afternoon
        } else if (shift.afternoon !== '') {
          doctorSchedule[doctor.name].departmentsByDate[date].afternoon = shift.afternoon
          doctorSchedule[doctor.name].afternoonShifts.push(shift.afternoon)
        }
        // 🔴 shift.afternoon 是空字符串，departmentsByDate[date].afternoon 已经在初始化时设置为 "休息"

        // 添加到schedule数据结构
        if (shift.morning !== '' && shift.morning !== '休息' && shift.morning !== '请假') {
          schedule[date][shift.morning].push({
            doctor: doctor.name,
            shift: 'morning',
            department: shift.morning
          })
        }

        if (shift.afternoon !== '' && shift.afternoon !== '休息' && shift.afternoon !== '请假') {
          schedule[date][shift.afternoon].push({
            doctor: doctor.name,
            shift: 'afternoon',
            department: shift.afternoon
          })
        }

        // 设置夜班
        if (doctor.isDutyDoctor && date === doctor.dutyDate) {
          doctorSchedule[doctor.name].nightShiftsByDate[date] = true
        }
      })

      // 🔴 计算工作天数（根据半天班次）
      dates.forEach(date => {
        const shifts = doctorSchedule[doctor.name].shifts[date]
        if (shifts.morning === 'work') {
          doctorSchedule[doctor.name].morningShiftDays += 0.5
        }
        if (shifts.afternoon === 'work') {
          doctorSchedule[doctor.name].afternoonShiftDays += 0.5
        }
      })

      // 🔴 重新计算休息天数（根据工作天数计算，支持半天班）
      // 休息天数 = 7 - 上午班天数 - 下午班天数
      doctorSchedule[doctor.name].restDays = 
        7 - doctorSchedule[doctor.name].morningShiftDays - doctorSchedule[doctor.name].afternoonShiftDays
    })

    // 🔴 添加特殊行（一线夜、二线夜、三线夜、补休、其他）
    const specialRows = ['一线夜', '二线夜', '三线夜', '补休', '其他']
    specialRows.forEach(rowName => {
      doctorSchedule[rowName] = {
        name: rowName,
        shifts: {},
        nightShiftsByDate: {},
        departmentsByDate: {},
        morningShifts: [],
        afternoonShifts: [],
        morningShiftDays: 0,
        afternoonShiftDays: 0,
        nightShifts: 0,
        restDays: 0,
        isSpecialRow: true
      }
      dates.forEach(date => {
        doctorSchedule[rowName].shifts[date] = {
          morning: 'off',
          afternoon: 'off'
        }
        doctorSchedule[rowName].departmentsByDate[date] = {
          morning: rowName === '三线夜' ? '邓旦' : '',
          afternoon: ''
        }
      })
    })

    return {
      dates,
      datesWithWeek,
      departments,
      schedule,
      dutySchedule,
      doctorSchedule,
      useHalfDay: true
    }
  }

  /**
   * 获取日期列表（从开始日期开始，连续n天）
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
   * 获取星期名称（英文）
   */
  private getDayName(date: string): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dateObj = new Date(date)
    return days[dateObj.getDay()]
  }

  /**
   * 获取星期名称（中文）
   */
  private getDayOfWeek(date: string): string {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const dateObj = new Date(date)
    return days[dateObj.getDay()]
  }

  /**
   * 格式化日期
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 导出排班表为Word文档（只保留医生排班表）
   */
  async exportSchedule(scheduleData: ScheduleData): Promise<Buffer> {
    const { dates, datesWithWeek, departments, schedule, dutySchedule, doctorSchedule } = scheduleData

    const children: (Paragraph | Table)[] = []

    // 标题
    children.push(
      new Paragraph({
        text: '医院排班表',
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    )

    // 医生排班表
    children.push(
      new Paragraph({
        text: '医生排班表',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
      })
    )

    const doctorTableRows: TableRow[] = []

    // 表头
    const doctorHeaderRow = new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '医生', bold: true })] })] }),
        ...datesWithWeek.map(date => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: date, bold: true })] })] }))
      ]
    })
    doctorTableRows.push(doctorHeaderRow)

    // 遍历所有医生
    Object.values(doctorSchedule).forEach((doctor: any) => {
      const rowCells = [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: doctor.name, bold: true })] })] })]

      dates.forEach(date => {
        const shifts = doctor.shifts?.[date]
        const depts = doctor.departmentsByDate?.[date]
        const isDuty = doctor.nightShiftsByDate?.[date]
        const isDirector = doctor.isDirector
        const isSpecialRow = doctor.isSpecialRow

        let shiftText = ''
        let shiftColor = '000000' // 默认黑色

        if (isDirector) {
          // 邓旦医生（科室主任）：周一到周五显示"-"，周六周日显示"休息"
          const dateObj = new Date(date)
          const dayOfWeek = dateObj.getDay()
          if (dayOfWeek === 0 || dayOfWeek === 6) {
            // 周末
            shiftText = '休息'
            shiftColor = '808080' // 灰色
          } else {
            // 工作日
            shiftText = '-'
            shiftColor = 'D3D3D3' // 浅灰色
          }
        } else if (isSpecialRow) {
          // 特殊行（一线夜、二线夜、三线夜、补休、其他）
          if (doctor.name === '三线夜') {
            // 三线夜：显示"邓旦"
            shiftText = '邓旦'
            shiftColor = '008000' // 绿色
          } else if (doctor.name === '补休' || doctor.name === '其他') {
            // 补休和其他：显示用户输入的内容
            shiftText = depts?.morning || ''
            shiftColor = '008000' // 绿色
          } else {
            // 一线夜和二线夜：显示选择的医生
            shiftText = depts?.morning || '选择医生'
            shiftColor = depts?.morning ? '008000' : 'D3D3D3' // 绿色或浅灰色
          }
        } else if (isDuty) {
          // 值班医生
          const dutyDepartment = depts?.morning || depts?.afternoon || ''
          shiftText = dutyDepartment ? `${dutyDepartment}（值班）` : '值班'
          shiftColor = 'FF0000' // 红色
        } else if (!shifts) {
          // 无排班数据
          shiftText = '-'
          shiftColor = 'D3D3D3' // 浅灰色
        } else if (shifts.morning === 'off' && shifts.afternoon === 'off') {
          // 全天休息
          const morningDept = depts?.morning
          const afternoonDept = depts?.afternoon

          if (morningDept === '休息' && afternoonDept === '休息') {
            shiftText = '休息'
            shiftColor = '808080' // 灰色
          } else if (morningDept === '请假' && afternoonDept === '请假') {
            shiftText = '请假'
            shiftColor = 'FFA500' // 橙色
          } else if (morningDept === '请输入' && afternoonDept === '请输入') {
            shiftText = '请输入'
            shiftColor = 'D3D3D3' // 浅灰色
          } else {
            // 混合状态
            shiftText = `${morningDept || '休息'}\n${afternoonDept || '休息'}`
            shiftColor = 'FFA500' // 橙色
          }
        } else if (shifts.morning === 'work' && shifts.afternoon === 'work') {
          // 全天上班
          const morningDept = depts?.morning
          const afternoonDept = depts?.afternoon

          if (morningDept === afternoonDept) {
            shiftText = morningDept || '未知'
          } else {
            shiftText = `${morningDept || '未知'}\n${afternoonDept || '未知'}`
          }
          shiftColor = '0000FF' // 蓝色
        } else {
          // 半天上班
          if (shifts.morning === 'work') {
            shiftText = `上午：${depts?.morning || '未知'}\n下午：休息`
          } else {
            shiftText = `上午：休息\n下午：${depts?.afternoon || '未知'}`
          }
          shiftColor = 'FFA500' // 橙色
        }

        // 检查是否包含5诊室
        const has5Clinic = shiftText.includes('5诊室')
        if (has5Clinic && !isDuty) {
          shiftColor = 'FF0000' // 红色
        }

        rowCells.push(new TableCell({
          children: [new Paragraph({
            children: [new TextRun({
              text: shiftText,
              color: shiftColor
            })]
          })]
        }))
      })

      doctorTableRows.push(new TableRow({ children: rowCells }))
    })

    children.push(new Table({
      rows: doctorTableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left: { style: BorderStyle.SINGLE, size: 1 },
        right: { style: BorderStyle.SINGLE, size: 1 },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
        insideVertical: { style: BorderStyle.SINGLE, size: 1 }
      }
    }))

    const doc = new Document({
      sections: [{
        properties: {},
        children
      }]
    })

    return Packer.toBuffer(doc)
  }
}
