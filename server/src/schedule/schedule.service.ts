import { Injectable, BadRequestException } from '@nestjs/common'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun, HeadingLevel, AlignmentType } from 'docx'

// 固定的医生列表（14人）
const FIXED_DOCTORS = [
  '李茜', '姜维', '陈晓林', '高玲', '曹钰', '朱朝霞', '范冬黎', '杨波',
  '李丹', '黄丹', '邬海燕', '罗丹', '彭粤如', '周晓宇'
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

// 科室类
class Department {
  name: string
  morningOccupied: boolean
  afternoonOccupied: boolean
  morningDoctor: string | null
  afternoonDoctor: string | null

  constructor(name: string) {
    this.name = name
    this.morningOccupied = false
    this.afternoonOccupied = false
    this.morningDoctor = null
    this.afternoonDoctor = null
  }

  /**
   * 检查是否全天空闲
   */
  isFullDayAvailable(): boolean {
    return !this.morningOccupied && !this.afternoonOccupied
  }

  /**
   * 检查上午是否空闲
   */
  isMorningAvailable(): boolean {
    return !this.morningOccupied
  }

  /**
   * 检查下午是否空闲
   */
  isAfternoonAvailable(): boolean {
    return !this.afternoonOccupied
  }

  /**
   * 分配全天医生
   */
  assignFullDay(doctorName: string): void {
    this.morningOccupied = true
    this.afternoonOccupied = true
    this.morningDoctor = doctorName
    this.afternoonDoctor = doctorName
  }

  /**
   * 分配上午医生
   */
  assignMorning(doctorName: string): void {
    this.morningOccupied = true
    this.morningDoctor = doctorName
  }

  /**
   * 分配下午医生
   */
  assignAfternoon(doctorName: string): void {
    this.afternoonOccupied = true
    this.afternoonDoctor = doctorName
  }
}

// 天类
class Day {
  date: string
  dayOfWeek: string
  dutyDoctor: string | null
  departmentPool: Department[]
  doctorPool: Doctor[]

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
    this.departmentPool = departmentNames.map(name => new Department(name))
  }

  /**
   * 初始化医生池
   */
  initDoctorPool(doctors: Doctor[]): void {
    this.doctorPool = [...doctors]
  }

  /**
   * 从医生池中移除医生
   */
  removeDoctor(doctor: Doctor): void {
    const index = this.doctorPool.findIndex(d => d.id === doctor.id)
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
    '1诊室', '2诊室', '4诊室', '5诊室', '9诊室', '10诊室',
    '妇儿2', '妇儿4', '妇儿前', 'VIP/男2', '男3', '女2'
  ]

  /**
   * 生成排班表（主入口）
   */
  async generateSchedule(
    startDate: string,
    startDutyDoctor: string,
    selectedDepartments: SelectedDepartments,
    fixedSchedule?: FixedSchedule,
    leaveDoctors?: string[] | { doctor: string; dates: string[] }[]
  ): Promise<ScheduleData> {
    console.log('🔴 ===== 开始生成排班表 =====')
    console.log('🔴 起始日期:', startDate)
    console.log('🔴 起始值班医生:', startDutyDoctor)
    console.log('🔴 选中的科室:', selectedDepartments)

    // === 第一阶段：获取页面数据 ===
    console.log('\n🔴 ===== 第一阶段：获取页面数据 =====')

    // 获取日期列表（7天）
    const dates = this.getDates(startDate, 7)
    const dayNames = dates.map(date => this.getDayName(date))
    const datesWithWeek = dates.map(date => `${date} ${this.getDayOfWeek(date)}`)

    console.log('🔴 日期列表:', dates)
    console.log('🔴 星期列表:', dayNames)

    // 验证输入数据
    this.validateInput(startDutyDoctor, selectedDepartments)

    // 处理请假数据
    const leaveMap = this.processLeaveDoctors(leaveDoctors)
    console.log('🔴 请假医生:', leaveMap)

    // === 第二阶段：实例化医生并初始化 ===
    console.log('\n🔴 ===== 第二阶段：实例化医生并初始化 =====')

    // 实例化14个医生
    const doctors = FIXED_DOCTORS.map((name, id) => new Doctor(name, id))

    // 初始化医生排班表
    doctors.forEach(doctor => {
      dayNames.forEach(dayName => {
        doctor.schedule[dayName] = { morning: '', afternoon: '' }
      })
    })

    console.log('🔴 实例化14个医生完成')

    // 初始化7个天
    const days = dayNames.map((dayName, index) => new Day(dates[index], dayName))
    days.forEach(day => {
      day.initDepartmentPool(selectedDepartments[day.dayOfWeek as keyof SelectedDepartments] || [])
    })

    console.log('🔴 初始化7个天完成')

    // 生成值班医生表
    const dutySchedule = this.generateDutySchedule(
      doctors,
      startDutyDoctor,
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
      this.departments,
      dutySchedule
    )
  }

  /**
   * 生成值班医生表
   */
  private generateDutySchedule(
    doctors: Doctor[],
    startDutyDoctor: string,
    dates: string[],
    dayNames: string[],
    leaveMap: Record<string, string[]>,
    fixedSchedule?: FixedSchedule
  ): Record<string, string> {
    const dutySchedule: Record<string, string> = {}
    const startIndex = FIXED_DOCTORS.indexOf(startDutyDoctor)
    let currentIndex = startIndex

    // 记录每个医生不能值班的剩余天数（确保至少休息1天）
    const doctorDutyBlockDays: Record<string, number> = {}

    dates.forEach((date, index) => {
      const dayName = dayNames[index]

      // 每天开始前，减少所有医生的不能值班天数
      Object.keys(doctorDutyBlockDays).forEach(doctor => {
        if (doctorDutyBlockDays[doctor] > 0) {
          doctorDutyBlockDays[doctor]--
        }
      })

      // 找到可以值班的医生
      let selectedDoctor = ''
      let attemptCount = 0
      const maxAttempts = doctors.length * 2

      while (!selectedDoctor && attemptCount < maxAttempts) {
        const doctor = doctors[currentIndex % doctors.length]

        // 检查是否可以值班
        const canDuty = this.checkCanDuty(
          doctor,
          date,
          dayName,
          leaveMap,
          fixedSchedule,
          doctorDutyBlockDays
        )

        if (canDuty) {
          selectedDoctor = doctor.name
          doctor.isDutyDoctor = true
          doctor.dutyDate = date
          if (index + 1 < dates.length) {
            doctor.requiredRestDate = dates[index + 1]
          }

          // 设置该医生不能值班的剩余天数为1
          doctorDutyBlockDays[doctor.name] = 1

          console.log(`🔴 ${date} (${dayName}) 值班医生: ${doctor.name}`)
        }

        currentIndex++
        attemptCount++
      }

      if (!selectedDoctor) {
        throw new BadRequestException(`${date} 没有可用的值班医生`)
      }

      dutySchedule[date] = selectedDoctor
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

        const { morning, afternoon } = shift

        // 处理上午
        if (morning !== '请输入') {
          if (morning === '休息' || morning === '请假') {
            doctor.schedule[day.dayOfWeek].morning = morning
          } else {
            const dept = day.departmentPool.find(d => d.name === morning)
            if (dept) {
              if (dept.morningOccupied) {
                console.log(`  ⚠️ ${morning} 上午已被占用，${doctorName} 无法固定`)
              } else {
                dept.morningOccupied = true
                dept.morningDoctor = doctorName
                doctor.schedule[day.dayOfWeek].morning = morning
                doctor.workDays++
              }
            }
          }
        }

        // 处理下午
        if (afternoon !== '请输入') {
          if (afternoon === '休息' || afternoon === '请假') {
            doctor.schedule[day.dayOfWeek].afternoon = afternoon
          } else {
            const dept = day.departmentPool.find(d => d.name === afternoon)
            if (dept) {
              if (dept.afternoonOccupied) {
                console.log(`  ⚠️ ${afternoon} 下午已被占用，${doctorName} 无法固定`)
              } else {
                dept.afternoonOccupied = true
                dept.afternoonDoctor = doctorName
                doctor.schedule[day.dayOfWeek].afternoon = afternoon
                doctor.workDays++
              }
            }
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

      // Step 1: 值班医生先选科室
      const dutyDoctorName = dutySchedule[day.date]
      if (dutyDoctorName) {
        const dutyDoctor = doctors.find(d => d.name === dutyDoctorName)
        if (dutyDoctor) {
          // 从科室池找一个全天空闲的科室
          const availableDept = day.departmentPool.find(dept => dept.isFullDayAvailable())
          if (availableDept) {
            availableDept.assignFullDay(dutyDoctorName)
            dutyDoctor.schedule[day.dayOfWeek] = { morning: availableDept.name, afternoon: availableDept.name }
            dutyDoctor.workDays++
            day.removeDoctor(dutyDoctor)
            console.log(`  ✅ 值班医生 ${dutyDoctorName} 分配到 ${availableDept.name}（全天）`)
          } else {
            console.log(`  ⚠️ 没有全天空闲的科室给值班医生 ${dutyDoctorName}`)
          }
        }
      }

      // Step 2: 初始化医生池（移除休息、请假、已分配的医生）
      day.initDoctorPool(doctors.filter(doctor => {
        // 移除请假的医生
        if (leaveMap[doctor.name] && (leaveMap[doctor.name].length === 0 || leaveMap[doctor.name].includes(day.date))) {
          return false
        }
        // 移除值班医生（已分配）
        if (doctor.dutyDate === day.date) {
          return false
        }
        // 移除值班休息日的医生
        if (doctor.requiredRestDate === day.date) {
          return false
        }
        // 移除已有固定排班的医生
        if (doctor.schedule[day.dayOfWeek].morning !== '' ||
            doctor.schedule[day.dayOfWeek].afternoon !== '') {
          return false
        }
        return true
      }))

      console.log(`  📊 医生池: ${day.doctorPool.map(d => d.name).join(', ')}`)

      // Step 3: 从第一个科室到最后一个科室选医生
      day.departmentPool.forEach(dept => {
        // 科室全天空闲：选择一个医生，全天在该科室
        if (dept.isFullDayAvailable()) {
          if (day.doctorPool.length > 0) {
            const doctor = this.selectDoctor(day.doctorPool, day.dayOfWeek, index, doctors, dates, dayNames)
            if (doctor) {
              dept.assignFullDay(doctor.name)
              doctor.schedule[day.dayOfWeek] = { morning: dept.name, afternoon: dept.name }
              doctor.workDays++
              doctor.consecutiveWorkDays++
              day.removeDoctor(doctor)
              console.log(`  ✅ ${dept.name} 分配给 ${doctor.name}（全天）`)
            }
          }
        } else if (dept.isMorningAvailable()) {
          // 科室下午被占用：只选择上午医生
          if (day.doctorPool.length > 0) {
            const doctor = this.selectDoctor(day.doctorPool, day.dayOfWeek, index, doctors, dates, dayNames)
            if (doctor) {
              dept.assignMorning(doctor.name)
              doctor.schedule[day.dayOfWeek].morning = dept.name
              doctor.workDays++
              doctor.consecutiveWorkDays++
              day.removeDoctor(doctor)
              console.log(`  ✅ ${dept.name} 上午分配给 ${doctor.name}`)
            }
          }
        } else if (dept.isAfternoonAvailable()) {
          // 科室上午被占用：只选择下午医生
          if (day.doctorPool.length > 0) {
            const doctor = this.selectDoctor(day.doctorPool, day.dayOfWeek, index, doctors, dates, dayNames)
            if (doctor) {
              dept.assignAfternoon(doctor.name)
              doctor.schedule[day.dayOfWeek].afternoon = dept.name
              doctor.workDays++
              doctor.consecutiveWorkDays++
              day.removeDoctor(doctor)
              console.log(`  ✅ ${dept.name} 下午分配给 ${doctor.name}`)
            }
          }
        }
      })

      // Step 4: 剩余医生赋值"休息"
      day.doctorPool.forEach(doctor => {
        doctor.schedule[day.dayOfWeek] = { morning: '休息', afternoon: '休息' }
        doctor.restDays++
        doctor.consecutiveWorkDays = 0
        console.log(`  ✅ ${doctor.name} 休息`)
      })

      console.log(`🔴 ===== ${day.date} (${day.dayOfWeek}) 排班完成 =====`)
    })
  }

  /**
   * 选择医生（包含第三天和第六天的特殊规则）
   */
  private selectDoctor(
    doctorPool: Doctor[],
    dayName: string,
    dayIndex: number,
    allDoctors: Doctor[],
    dates: string[],
    dayNames: string[]
  ): Doctor | null {
    // 第三天（索引2）开始：优先排休息够了2天的医生
    if (dayIndex >= 2) {
      const restedDoctors = doctorPool.filter(doctor => {
        // 检查前两天是否都休息
        const day1 = dayNames[dayIndex - 2]
        const day2 = dayNames[dayIndex - 1]
        return doctor.isFullDayRest(day1) && doctor.isFullDayRest(day2)
      })

      if (restedDoctors.length > 0) {
        console.log(`  🔍 优先选择休息够2天的医生: ${restedDoctors.map(d => d.name).join(', ')}`)
        return restedDoctors[Math.floor(Math.random() * restedDoctors.length)]
      }
    }

    // 第六天（索引5）开始：检查连续工作5天
    if (dayIndex >= 5) {
      const doctorsToRest = doctorPool.filter(doctor => doctor.consecutiveWorkDays >= 5)
      if (doctorsToRest.length > 0) {
        console.log(`  🔍 连续工作5天的医生，优先休息: ${doctorsToRest.map(d => d.name).join(', ')}`)
        // 从医生池中移除这些医生
        doctorsToRest.forEach(d => {
          const idx = doctorPool.findIndex(p => p.id === d.id)
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
    startDutyDoctor: string,
    selectedDepartments: SelectedDepartments
  ): void {
    if (!FIXED_DOCTORS.includes(startDutyDoctor)) {
      throw new BadRequestException(`起始值班医生"${startDutyDoctor}"不存在`)
    }

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
      // 检查第一个元素类型
      const firstItem = leaveDoctors[0]

      if (typeof firstItem === 'string') {
        // 简单的医生名称数组
        (leaveDoctors as string[]).forEach((doctor: string) => {
          leaveMap[doctor] = []
        })
      } else {
        // 对象数组
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
    departments: string[],
    dutySchedule: Record<string, string>
  ): ScheduleData {
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

        // 设置shifts
        if (shift.morning === '休息' || shift.morning === '请假') {
          doctorSchedule[doctor.name].shifts[date] = {
            morning: 'off',
            afternoon: shift.afternoon === '休息' || shift.afternoon === '请假' ? 'off' : 'work'
          }
        } else if (shift.morning !== '') {
          doctorSchedule[doctor.name].shifts[date] = {
            morning: 'work',
            afternoon: shift.afternoon === '休息' || shift.afternoon === '请假' ? 'off' : 'work'
          }
        } else if (shift.afternoon === '休息' || shift.afternoon === '请假') {
          doctorSchedule[doctor.name].shifts[date] = {
            morning: 'off',
            afternoon: 'off'
          }
        }

        // 设置departmentsByDate
        if (shift.morning !== '' && shift.morning !== '休息' && shift.morning !== '请假') {
          if (!doctorSchedule[doctor.name].departmentsByDate[date]) {
            doctorSchedule[doctor.name].departmentsByDate[date] = { morning: '', afternoon: '' }
          }
          doctorSchedule[doctor.name].departmentsByDate[date].morning = shift.morning
          doctorSchedule[doctor.name].morningShifts.push(shift.morning)
        }

        if (shift.afternoon !== '' && shift.afternoon !== '休息' && shift.afternoon !== '请假') {
          if (!doctorSchedule[doctor.name].departmentsByDate[date]) {
            doctorSchedule[doctor.name].departmentsByDate[date] = { morning: '', afternoon: '' }
          }
          doctorSchedule[doctor.name].departmentsByDate[date].afternoon = shift.afternoon
          doctorSchedule[doctor.name].afternoonShifts.push(shift.afternoon)
        }

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
   * 导出排班表为Word文档
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

    // 科室排班表
    children.push(
      new Paragraph({
        text: '一、科室排班表',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
      })
    )

    const departmentTableRows: TableRow[] = []
    const departmentHeaderRow = new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '日期', bold: true })] })] }),
        ...datesWithWeek.map(date => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: date, bold: true })] })] }))
      ]
    })
    departmentTableRows.push(departmentHeaderRow)

    departments.forEach(dept => {
      const rowCells = [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: dept, bold: true })] })] })]

      dates.forEach(date => {
        const assignments = schedule[date]?.[dept] || []
        const doctorNames = assignments.map(a => a.doctor).join('、')
        rowCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: doctorNames || '-' })] })] }))
      })

      departmentTableRows.push(new TableRow({ children: rowCells }))
    })

    children.push(new Table({
      rows: departmentTableRows,
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

    // 医生排班表
    children.push(
      new Paragraph({
        text: '二、医生排班表',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 600, after: 200 }
      })
    )

    const doctorTableRows: TableRow[] = []
    const doctorHeaderRow = new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '医生', bold: true })] })] }),
        ...datesWithWeek.map(date => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: date, bold: true })] })] })),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '值班次数', bold: true })] })] })
      ]
    })
    doctorTableRows.push(doctorHeaderRow)

    Object.values(doctorSchedule).forEach((doctor: any) => {
      const rowCells = [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: doctor.name, bold: true })] })] })]

      dates.forEach(date => {
        const shifts = doctor.shifts?.[date]
        let shiftText = ''
        if (!shifts) {
          shiftText = '-'
        } else if (shifts.morning === 'work' && shifts.afternoon === 'work') {
          const dept = doctor.departmentsByDate?.[date]?.morning || '未知'
          shiftText = dept
        } else if (shifts.morning === 'work') {
          const dept = doctor.departmentsByDate?.[date]?.morning || '未知'
          shiftText = `上午:${dept}`
        } else if (shifts.afternoon === 'work') {
          const dept = doctor.departmentsByDate?.[date]?.afternoon || '未知'
          shiftText = `下午:${dept}`
        } else {
          shiftText = '休息'
        }

        const isDuty = doctor.nightShiftsByDate?.[date]
        if (isDuty && shiftText !== '休息') {
          shiftText = `${shiftText}（值班）`
        }

        rowCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: shiftText })] })] }))
      })

      rowCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(doctor.nightShifts || 0) })] })] }))
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

    // 值班表
    children.push(
      new Paragraph({
        text: '三、值班表',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 600, after: 200 }
      })
    )

    const dutyTableRows: TableRow[] = []
    const dutyHeaderRow = new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '日期', bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '值班医生', bold: true })] })] })
      ]
    })
    dutyTableRows.push(dutyHeaderRow)

    dates.forEach((date, index) => {
      const dutyDoctor = dutySchedule[date] || '-'
      dutyTableRows.push(new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: datesWithWeek[index] })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: dutyDoctor, bold: true })] })] })
        ]
      }))
    })

    children.push(new Table({
      rows: dutyTableRows,
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
