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

// 科室占用记录
interface DepartmentUsage {
  [day: string]: {
    [dept: string]: {
      morning: string
      afternoon: string
    }
  }
}

// 医生类
class Doctor {
  id: number
  name: string
  isDutyDoctor: boolean
  dutyDate: string | null
  requiredRestDate: string | null
  workDays: number
  schedule: Record<string, { morning: string; afternoon: string }>

  constructor(name: string, id: number) {
    this.id = id
    this.name = name
    this.isDutyDoctor = false
    this.dutyDate = null
    this.requiredRestDate = null
    this.workDays = 0
    this.schedule = {}
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
    console.log('🔴 开始生成排班表')
    console.log('🔴 起始日期:', startDate)
    console.log('🔴 起始值班医生:', startDutyDoctor)
    console.log('🔴 选中的科室:', selectedDepartments)

    // 步骤1：验证输入数据
    this.validateInput(startDutyDoctor, selectedDepartments)

    // 步骤2：获取日期列表（7天）
    const dates = this.getDates(startDate, 7)
    const dayNames = dates.map(date => this.getDayName(date))
    const datesWithWeek = dates.map(date => `${date} ${this.getDayOfWeek(date)}`)

    console.log('🔴 日期列表:', dates)
    console.log('🔴 星期列表:', dayNames)

    // 步骤3：创建医生对象
    const doctors = FIXED_DOCTORS.map((name, id) => new Doctor(name, id))

    // 初始化医生排班表
    doctors.forEach(doctor => {
      dayNames.forEach(dayName => {
        doctor.schedule[dayName] = { morning: '', afternoon: '' }
      })
    })

    // 步骤4：处理请假
    const leaveMap = this.processLeaveDoctors(leaveDoctors)

    // 步骤5：生成值班医生表
    const dutySchedule = this.generateDutySchedule(
      doctors,
      startDutyDoctor,
      dates,
      dayNames,
      leaveMap,
      fixedSchedule
    )

    console.log('🔴 值班医生表:', dutySchedule)

    // 步骤6：初始化科室占用记录
    const departmentUsage = this.initDepartmentUsage(selectedDepartments)

    // 步骤7：处理固定排班
    this.processFixedSchedule(
      doctors,
      dates,
      dayNames,
      fixedSchedule,
      leaveMap,
      departmentUsage
    )

    // 步骤8：按天排班（核心逻辑）
    this.scheduleByDay(
      doctors,
      dates,
      dayNames,
      selectedDepartments,
      departmentUsage,
      dutySchedule,
      leaveMap
    )

    // 步骤9：转换为旧的数据结构（保持兼容）
    return this.convertToLegacyFormat(
      doctors,
      dates,
      datesWithWeek,
      this.departments,
      dutySchedule
    )
  }

  /**
   * 验证输入数据
   */
  private validateInput(
    startDutyDoctor: string,
    selectedDepartments: SelectedDepartments
  ): void {
    // 检查起始值班医生是否存在
    if (!FIXED_DOCTORS.includes(startDutyDoctor)) {
      throw new BadRequestException(`起始值班医生"${startDutyDoctor}"不存在`)
    }

    // 检查每天至少选择4个科室
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
      if (typeof leaveDoctors[0] === 'string') {
        // 简单的医生名称数组，表示这些医生请假所有日期
        leaveDoctors.forEach((doctor: string) => {
          leaveMap[doctor] = []
        })
      } else {
        // 对象数组，指定医生和请假日期
        leaveDoctors.forEach((item: { doctor: string; dates: string[] }) => {
          leaveMap[item.doctor] = item.dates
        })
      }
    }

    console.log('🔴 请假医生:', leaveMap)
    return leaveMap
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
      // 每天开始前，减少所有医生的不能值班天数
      Object.keys(doctorDutyBlockDays).forEach(doctor => {
        if (doctorDutyBlockDays[doctor] > 0) {
          doctorDutyBlockDays[doctor]--
        }
      })

      // 找到可以值班的医生
      let selectedDoctor = ''
      let attemptCount = 0
      const maxAttempts = doctors.length * 2 // 最多尝试2轮

      while (!selectedDoctor && attemptCount < maxAttempts) {
        const doctor = doctors[currentIndex % doctors.length]
        const dayName = dayNames[index]

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

    console.log('🔴 值班医生表生成完成:', dutySchedule)
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
      console.log(`  ${doctor.name} 在 ${date} 请假，跳过`)
      return false
    }

    // 检查是否处于值班休息期
    if (doctorDutyBlockDays && doctorDutyBlockDays[doctor.name] > 0) {
      console.log(`  ${doctor.name} 处于值班休息期，跳过`)
      return false
    }

    // 检查固定排班是否为"休息"或"请假"
    if (fixedSchedule && fixedSchedule[date] && fixedSchedule[date][doctor.name]) {
      const { morning, afternoon } = fixedSchedule[date][doctor.name]
      if (morning === '休息' || morning === '请假' || afternoon === '休息' || afternoon === '请假') {
        console.log(`  ${doctor.name} 在 ${date} 固定为"${morning}"或"${afternoon}"，跳过`)
        return false
      }
    }

    return true
  }

  /**
   * 初始化科室占用记录
   */
  private initDepartmentUsage(selectedDepartments: SelectedDepartments): DepartmentUsage {
    const departmentUsage: DepartmentUsage = {}
    const days: (keyof SelectedDepartments)[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

    days.forEach(day => {
      departmentUsage[day] = {}
      selectedDepartments[day].forEach(dept => {
        departmentUsage[day][dept] = { morning: '', afternoon: '' }
      })
    })

    console.log('🔴 科室占用记录初始化完成')
    return departmentUsage
  }

  /**
   * 处理固定排班
   */
  private processFixedSchedule(
    doctors: Doctor[],
    dates: string[],
    dayNames: string[],
    fixedSchedule: FixedSchedule | undefined,
    leaveMap: Record<string, string[]>,
    departmentUsage: DepartmentUsage
  ): void {
    if (!fixedSchedule) {
      console.log('🔴 没有固定排班，跳过处理')
      return
    }

    dates.forEach((date, index) => {
      const dayName = dayNames[index]
      const dayAssignments = fixedSchedule[date]

      if (!dayAssignments) return

      Object.entries(dayAssignments).forEach(([doctorName, shift]) => {
        const doctor = doctors.find(d => d.name === doctorName)
        if (!doctor) return

        const { morning, afternoon } = shift

        // 检查是否为全天空值
        if (morning === '请输入' && afternoon === '请输入') {
          console.log(`  ${date} ${doctorName} 固定排班为空，跳过`)
          return
        }

        // 处理上午
        if (morning !== '请输入') {
          if (morning === '休息' || morning === '请假') {
            doctor.schedule[dayName].morning = morning
          } else {
            // 检查科室是否被占用
            const usage = departmentUsage[dayName][morning]
            if (usage.morning !== '') {
              console.log(`  警告：${morning} 上午已被 ${usage.morning} 占用，${doctorName} 无法固定`)
            } else {
              usage.morning = doctorName
              doctor.schedule[dayName].morning = morning
              doctor.workDays++
            }
          }
        }

        // 处理下午
        if (afternoon !== '请输入') {
          if (afternoon === '休息' || afternoon === '请假') {
            doctor.schedule[dayName].afternoon = afternoon
          } else {
            // 检查科室是否被占用
            const usage = departmentUsage[dayName][afternoon]
            if (usage.afternoon !== '') {
              console.log(`  警告：${afternoon} 下午已被 ${usage.afternoon} 占用，${doctorName} 无法固定`)
            } else {
              usage.afternoon = doctorName
              doctor.schedule[dayName].afternoon = afternoon
              doctor.workDays++
            }
          }
        }

        console.log(`  ${date} ${doctorName} 固定排班: ${doctor.schedule[dayName]}`)
      })
    })

    console.log('🔴 固定排班处理完成')
  }

  /**
   * 按天排班（核心逻辑）
   */
  private scheduleByDay(
    doctors: Doctor[],
    dates: string[],
    dayNames: string[],
    selectedDepartments: SelectedDepartments,
    departmentUsage: DepartmentUsage,
    dutySchedule: Record<string, string>,
    leaveMap: Record<string, string[]>
  ): void {
    console.log('🔴 开始按天排班')

    dates.forEach((date, index) => {
      const dayName = dayNames[index]
      const dayDepartments = selectedDepartments[dayName]

      console.log(`🔴 ===== ${date} (${dayName}) 排班 =====`)

      // 步骤1：优先给该天值班医生选一个科室
      const dutyDoctorName = dutySchedule[date]
      if (dutyDoctorName) {
        const dutyDoctor = doctors.find(d => d.name === dutyDoctorName)
        if (dutyDoctor) {
          // 查找没有被用户固定的科室（上午和下午都空闲）
          const availableDept = dayDepartments.find(dept => {
            const usage = departmentUsage[dayName][dept]
            return usage.morning === '' && usage.afternoon === ''
          })

          if (availableDept) {
            // 分配科室给值班医生
            departmentUsage[dayName][availableDept].morning = dutyDoctorName
            departmentUsage[dayName][availableDept].afternoon = dutyDoctorName
            dutyDoctor.schedule[dayName] = { morning: availableDept, afternoon: availableDept }
            dutyDoctor.workDays++
            console.log(`  ✅ 值班医生 ${dutyDoctorName} 分配到 ${availableDept}`)
          } else {
            console.log(`  ⚠️ 没有可用的科室给值班医生 ${dutyDoctorName}`)
          }
        }
      }

      // 步骤2：从剩下科室随机选医生，填满每个科室
      dayDepartments.forEach(dept => {
        const usage = departmentUsage[dayName][dept]

        // 上午还没人，分配医生
        if (usage.morning === '') {
          const availableDoctor = this.selectAvailableDoctor(
            doctors,
            dayName,
            date,
            'morning',
            leaveMap,
            dutySchedule
          )
          if (availableDoctor) {
            usage.morning = availableDoctor.name
            availableDoctor.schedule[dayName].morning = dept
            availableDoctor.workDays++
            console.log(`  ✅ 上午 ${dept} 分配给 ${availableDoctor.name}`)
          }
        }

        // 下午还没人，分配医生
        if (usage.afternoon === '') {
          const availableDoctor = this.selectAvailableDoctor(
            doctors,
            dayName,
            date,
            'afternoon',
            leaveMap,
            dutySchedule
          )
          if (availableDoctor) {
            usage.afternoon = availableDoctor.name
            availableDoctor.schedule[dayName].afternoon = dept
            availableDoctor.workDays++
            console.log(`  ✅ 下午 ${dept} 分配给 ${availableDoctor.name}`)
          }
        }
      })

      // 步骤3：最后2-3天，优先安排休息够了的医生
      if (index >= dates.length - 3) {
        this.adjustForRestDays(doctors, dayName, dates, index)
      }

      // 步骤4：设置空位为"休息"
      doctors.forEach(doctor => {
        if (doctor.schedule[dayName].morning === '') {
          doctor.schedule[dayName].morning = '休息'
        }
        if (doctor.schedule[dayName].afternoon === '') {
          doctor.schedule[dayName].afternoon = '休息'
        }
      })

      console.log(`🔴 ===== ${date} (${dayName}) 排班完成 =====`)
    })

    console.log('🔴 按天排班完成')
  }

  /**
   * 选择可用的医生
   */
  private selectAvailableDoctor(
    doctors: Doctor[],
    dayName: string,
    date: string,
    period: 'morning' | 'afternoon',
    leaveMap: Record<string, string[]>,
    dutySchedule: Record<string, string>
  ): Doctor | null {
    // 找到可用的医生列表
    const availableDoctors = doctors.filter(doctor => {
      // 检查是否已经在当天有排班
      if (period === 'morning' && doctor.schedule[dayName].afternoon !== '') {
        return false // 下午已经有排班，不能再排上午
      }
      if (period === 'afternoon' && doctor.schedule[dayName].morning !== '') {
        return false // 上午已经有排班，不能再排下午
      }

      // 检查是否请假
      if (leaveMap[doctor.name] && (leaveMap[doctor.name].length === 0 || leaveMap[doctor.name].includes(date))) {
        return false
      }

      // 检查是否是值班医生且在值班当天（已经被优先分配了）
      if (doctor.isDutyDoctor && doctor.dutyDate === date) {
        return false
      }

      // 检查是否是值班医生且在强制休息日
      if (doctor.isDutyDoctor && doctor.requiredRestDate === date) {
        return false
      }

      return true
    })

    if (availableDoctors.length === 0) {
      console.log(`  ⚠️ 没有可用的医生用于 ${period === 'morning' ? '上午' : '下午'}`)
      return null
    }

    // 随机选择一个医生
    const selectedDoctor = availableDoctors[Math.floor(Math.random() * availableDoctors.length)]
    return selectedDoctor
  }

  /**
   * 调整休息天数
   */
  private adjustForRestDays(
    doctors: Doctor[],
    currentDayName: string,
    dates: string[],
    currentIndex: number
  ): void {
    console.log(`🔴 调整 ${currentDayName} 的休息天数`)

    doctors.forEach(doctor => {
      // 计算休息天数
      let restDays = 0
      for (let i = 0; i < currentIndex; i++) {
        const dayName = this.getDayName(dates[i])
        const schedule = doctor.schedule[dayName]
        if (schedule.morning === '休息' || schedule.morning === '请假' ||
            schedule.afternoon === '休息' || schedule.afternoon === '请假') {
          restDays++
        }
      }

      // 如果休息天数不足，优先安排休息
      if (restDays < 1) {
        // 如果当天还没有排班，设置为休息
        if (doctor.schedule[currentDayName].morning === '' &&
            doctor.schedule[currentDayName].afternoon === '') {
          doctor.schedule[currentDayName] = { morning: '休息', afternoon: '休息' }
          console.log(`  ✅ ${doctor.name} 休息天数不足（${restDays}天），优先安排休息`)
        }
      }
    })
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
    // 初始化旧的数据结构
    const schedule: Record<string, Record<string, ScheduleSlot[]>> = {}
    dates.forEach(date => {
      schedule[date] = {}
      departments.forEach(dept => {
        schedule[date][dept] = []
      })
    })

    const doctorSchedule: Record<string, DoctorSchedule> = {}

    // 转换医生数据
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
        restDays: 0
      }

      // 转换每天的排班
      dates.forEach((date, index) => {
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
    // 表头
    const departmentHeaderRow = new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '日期', bold: true })] })] }),
        ...datesWithWeek.map(date => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: date, bold: true })] })] }))
      ]
    })
    departmentTableRows.push(departmentHeaderRow)

    // 每个科室一行
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
    // 表头
    const doctorHeaderRow = new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '医生', bold: true })] })] }),
        ...datesWithWeek.map(date => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: date, bold: true })] })] })),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '值班次数', bold: true })] })] })
      ]
    })
    doctorTableRows.push(doctorHeaderRow)

    // 每个医生一行
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

        // 检查是否是值班
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
    // 表头
    const dutyHeaderRow = new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '日期', bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '值班医生', bold: true })] })] })
      ]
    })
    dutyTableRows.push(dutyHeaderRow)

    // 每天一行
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
