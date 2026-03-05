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
    [doctor: string]: {
      morning: string | '请输入' | '休息' | '请假'
      afternoon: string | '请输入' | '休息' | '请假'
    }
  }
}

// 科室选择（每天独立的科室）
export interface SelectedDepartments {
  Monday: string[]
  Tuesday: string[]
  Wednesday: string[]
  Thursday: string[]
  Friday: string[]
  Saturday: string[]
  Sunday: string[]
}

// 默认科室
const DEFAULT_DEPARTMENTS = [
  '1诊室', '2诊室', '4诊室', '5诊室', '9诊室', '10诊室',
  '妇儿2', '妇儿4', '妇儿前', 'VIP/男2', '男3', '女2'
]

const DEFAULT_WEEKEND_DEPARTMENTS = ['1诊室', '2诊室', '4诊室', '5诊室']

// 班次类型
export type ShiftType = 'morning' | 'afternoon' | 'night' | 'off'

// 排班槽位
export interface ScheduleSlot {
  doctor: string
  shift: ShiftType
  department?: string
}

// 医生排班表（每天的上下午）
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

// 🔴 CRITICAL: 医生类（面向对象设计）
class Doctor {
  id: number
  name: string
  isDutyDoctor: boolean
  dutyDate: string
  requiredRestDate: string
  workDays: number
  schedule: {
    Monday: { morning: ''; afternoon: '' }
    Tuesday: { morning: ''; afternoon: '' }
    Wednesday: { morning: ''; afternoon: '' }
    Thursday: { morning: ''; afternoon: '' }
    Friday: { morning: ''; afternoon: '' }
    Saturday: { morning: ''; afternoon: '' }
    Sunday: { morning: ''; afternoon: '' }
  }

  constructor(id: number, name: string) {
    this.id = id
    this.name = name
    this.isDutyDoctor = false
    this.dutyDate = ''
    this.requiredRestDate = ''
    this.workDays = 0
    this.schedule = {
      Monday: { morning: '', afternoon: '' },
      Tuesday: { morning: '', afternoon: '' },
      Wednesday: { morning: '', afternoon: '' },
      Thursday: { morning: '', afternoon: '' },
      Friday: { morning: '', afternoon: '' },
      Saturday: { morning: '', afternoon: '' },
      Sunday: { morning: '', afternoon: '' }
    }
  }
}

// 科室占用记录（防止三个医生共用诊室）
interface DepartmentUsage {
  [day: string]: {
    [dept: string]: {
      morning: string
      afternoon: string
    }
  }
}

@Injectable()
export class ScheduleService {
  // 科室列表
  private departments = DEFAULT_DEPARTMENTS

  /**
   * 生成排班表（新版本 - 面向对象设计）
   * @param startDate 开始日期（YYYY-MM-DD）
   * @param startDutyDoctor 起始值班医生
   * @param selectedDepartments 每天选择的科室
   * @param fixedSchedule 固定排班数据（用户手动设置的）
   * @param leaveDoctors 请假医生列表
   */
  async generateSchedule(
    startDate: string,
    startDutyDoctor: string,
    selectedDepartments: SelectedDepartments,
    fixedSchedule?: FixedSchedule,
    leaveDoctors?: string[] | LeaveInfo[]
  ): Promise<ScheduleData> {
    console.log('🔥 generateSchedule 被调用（新版本）')
    console.log('🔥 startDate:', startDate)
    console.log('🔥 startDutyDoctor:', startDutyDoctor)
    console.log('🔥 selectedDepartments:', selectedDepartments)
    console.log('🔥 fixedSchedule:', fixedSchedule)

    // 步骤1：验证数据
    this.validateInput(startDutyDoctor, selectedDepartments)

    // 步骤2：生成7天的日期
    const dates = this.getDates(startDate, 7)
    const datesWithWeek = dates.map(date => this.getDateWithWeek(date))
    const dayNames = dates.map(date => this.getDayName(date)) // ['Monday', 'Tuesday', ...]

    // 步骤3：实例化14个医生
    const doctors = FIXED_DOCTORS.map((name, index) => new Doctor(index, name))
    console.log('🔴 实例化了', doctors.length, '个医生')

    // 步骤4：将请假信息转换为统一格式
    const leaveMap: Record<string, string[]> = {}
    if (leaveDoctors && leaveDoctors.length > 0) {
      leaveDoctors.forEach(leave => {
        if (typeof leave === 'string') {
          leaveMap[leave] = [] // 空数组表示该医生一周都请假
        } else {
          leaveMap[leave.doctor] = leave.dates
        }
      })
      console.log('🔴 请假信息:', leaveMap)
    }

    // 步骤5：生成值班医生（从起始值班医生轮换，跳过请假和固定休息的医生）
    const dutySchedule = this.generateDutySchedule(
      doctors,
      startDutyDoctor,
      dates,
      leaveMap,
      fixedSchedule
    )

    // 步骤6：初始化科室占用记录
    const departmentUsage = this.initDepartmentUsage(selectedDepartments)

    // 步骤7：生成科室池
    const departmentPools = this.generateDepartmentPools(selectedDepartments)

    // 步骤8：遍历页面数据，初始化医生状态
    this.initializeDoctorsFromFixedSchedule(
      doctors,
      dates,
      dayNames,
      fixedSchedule,
      leaveMap,
      departmentUsage,
      departmentPools,
      dutySchedule
    )

    // 步骤9：自动填充剩余空位
    this.fillRemainingSlots(
      doctors,
      dates,
      dayNames,
      departmentPools,
      dutySchedule
    )

    // 步骤10：转换为旧的数据结构（保持兼容）
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
      if (selectedDepartments[day].length < 4) {
        throw new BadRequestException(`${day}至少需要选择4个科室，当前选择了${selectedDepartments[day].length}个`)
      }
    })

    console.log('✅ 输入数据验证通过')
  }

  /**
   * 生成值班医生表
   */
  private generateDutySchedule(
    doctors: Doctor[],
    startDutyDoctor: string,
    dates: string[],
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
        const dayName = this.getDayName(date)

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
   * 生成科室池
   */
  private generateDepartmentPools(selectedDepartments: SelectedDepartments): Record<string, string[]> {
    const departmentPools: Record<string, string[]> = {}
    const days: (keyof SelectedDepartments)[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

    days.forEach(day => {
      departmentPools[day] = [...selectedDepartments[day]]
    })

    console.log('🔴 科室池生成完成:', departmentPools)
    return departmentPools
  }

  /**
   * 从固定排班初始化医生状态
   */
  private initializeDoctorsFromFixedSchedule(
    doctors: Doctor[],
    dates: string[],
    dayNames: string[],
    fixedSchedule: FixedSchedule | undefined,
    leaveMap: Record<string, string[]>,
    departmentUsage: DepartmentUsage,
    departmentPools: Record<string, string[]>,
    dutySchedule: Record<string, string>
  ): void {
    if (!fixedSchedule) {
      console.log('🔴 没有固定排班，跳过初始化')
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
            // 分配到科室
            try {
              this.checkAndSetDepartment(dayName, morning, 'morning', doctorName, departmentUsage)
              this.removeFromPool(dayName, morning, departmentPools)
              doctor.schedule[dayName].morning = morning
              doctor.workDays++
            } catch (error) {
              throw new BadRequestException(`${date} ${doctorName} 上午科室分配失败: ${error.message}`)
            }
          }
        }

        // 处理下午
        if (afternoon !== '请输入') {
          if (afternoon === '休息' || afternoon === '请假') {
            doctor.schedule[dayName].afternoon = afternoon
          } else {
            // 分配到科室
            try {
              this.checkAndSetDepartment(dayName, afternoon, 'afternoon', doctorName, departmentUsage)
              this.removeFromPool(dayName, afternoon, departmentPools)
              doctor.schedule[dayName].afternoon = afternoon
              doctor.workDays++
            } catch (error) {
              throw new BadRequestException(`${date} ${doctorName} 下午科室分配失败: ${error.message}`)
            }
          }
        }

        console.log(`  ${date} ${doctorName} 固定排班: ${doctor.schedule[dayName]}`)
      })
    })

    console.log('🔴 固定排班初始化完成')
  }

  /**
   * 检查并设置科室占用
   */
  private checkAndSetDepartment(
    day: string,
    dept: string,
    period: 'morning' | 'afternoon',
    doctor: string,
    departmentUsage: DepartmentUsage
  ): void {
    if (!departmentUsage[day] || !departmentUsage[day][dept]) {
      throw new Error(`${dept}不在${day}的科室池中`)
    }

    const occupied = departmentUsage[day][dept][period]
    if (occupied !== '') {
      const periodName = period === 'morning' ? '上午' : '下午'
      throw new Error(`${dept}${periodName}已被${occupied}占用`)
    }

    departmentUsage[day][dept][period] = doctor
  }

  /**
   * 从科室池移除科室
   */
  private removeFromPool(
    day: string,
    dept: string,
    departmentPools: Record<string, string[]>
  ): void {
    const index = departmentPools[day].indexOf(dept)
    if (index > -1) {
      departmentPools[day].splice(index, 1)
    }
  }

  /**
   * 自动填充剩余空位
   */
  private fillRemainingSlots(
    doctors: Doctor[],
    dates: string[],
    dayNames: string[],
    departmentPools: Record<string, string[]>,
    dutySchedule: Record<string, string>
  ): void {
    // 为值班医生优先分配科室
    this.assignDutyDoctors(
      doctors,
      dates,
      dayNames,
      departmentPools,
      dutySchedule
    )

    // 为其他医生填充剩余空位
    this.assignOtherDoctors(
      doctors,
      dates,
      dayNames,
      departmentPools
    )

    console.log('🔴 自动填充完成')
  }

  /**
   * 为值班医生分配科室
   */
  private assignDutyDoctors(
    doctors: Doctor[],
    dates: string[],
    dayNames: string[],
    departmentPools: Record<string, string[]>,
    dutySchedule: Record<string, string>
  ): void {
    const dutyDoctors = doctors.filter(d => d.isDutyDoctor)

    dutyDoctors.forEach(doctor => {
      dates.forEach((date, index) => {
        const dayName = dayNames[index]

        // 跳过强制休息日
        if (date === doctor.requiredRestDate) {
          doctor.schedule[dayName] = { morning: '休息', afternoon: '休息' }
          return
        }

        // 如果已经有固定排班，跳过
        if (doctor.schedule[dayName].morning !== '' || doctor.schedule[dayName].afternoon !== '') {
          return
        }

        // 为值班医生分配科室（全天）
        if (departmentPools[dayName].length > 0) {
          const dept = departmentPools[dayName][0]
          doctor.schedule[dayName] = { morning: dept, afternoon: dept }
          departmentPools[dayName].shift()
          doctor.workDays++
          console.log(`🔴 值班医生 ${doctor.name} ${dayName} 分配到 ${dept}`)
        }
      })
    })
  }

  /**
   * 为其他医生填充剩余空位
   */
  private assignOtherDoctors(
    doctors: Doctor[],
    dates: string[],
    dayNames: string[],
    departmentPools: Record<string, string[]>
  ): void {
    const otherDoctors = doctors.filter(d => !d.isDutyDoctor)

    dates.forEach((date, index) => {
      const dayName = dayNames[index]

      // 为当天的每个科室分配医生
      while (departmentPools[dayName].length > 0) {
        // 找到工作天数最少的医生
        const availableDoctors = otherDoctors.filter(doc => {
          // 检查医生当天是否有空位
          const hasEmptySlot = doc.schedule[dayName].morning === '' && doc.schedule[dayName].afternoon === ''
          if (!hasEmptySlot) return false

          // 检查医生是否请假
          const leaveInfo = FIXED_DOCTORS.includes(doc.name) ? undefined : undefined // TODO: 处理请假
          return true
        })

        if (availableDoctors.length === 0) break

        // 按工作天数排序
        availableDoctors.sort((a, b) => a.workDays - b.workDays)

        // 选择工作天数最少的医生
        const selectedDoctor = availableDoctors[0]
        const dept = departmentPools[dayName][0]

        // 分配科室（全天）
        selectedDoctor.schedule[dayName] = { morning: dept, afternoon: dept }
        departmentPools[dayName].shift()
        selectedDoctor.workDays++

        console.log(`🔴 ${dayName} 为 ${selectedDoctor.name} 分配到 ${dept}`)
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
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 获取带星期的日期（YYYY-MM-DD 周X）
   */
  private getDateWithWeek(date: string): string {
    const dateObj = new Date(date)
    const dayOfWeek = dateObj.getDay()
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${date} ${weekDays[dayOfWeek]}`
  }

  /**
   * 获取星期名称（Monday, Tuesday, ...）
   */
  private getDayName(date: string): string {
    const dateObj = new Date(date)
    const dayOfWeek = dateObj.getDay()
    const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return weekDays[dayOfWeek]
  }

  /**
   * 获取下一个日期
   */
  private getNextDay(date: string): string {
    const dateObj = new Date(date)
    dateObj.setDate(dateObj.getDate() + 1)
    return this.formatDate(dateObj)
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
        rowCells.push(new TableCell({ children: [new Paragraph({ text: doctorNames || '-' })] }))
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

        rowCells.push(new TableCell({ children: [new Paragraph({ text: shiftText })] }))
      })

      rowCells.push(new TableCell({ children: [new Paragraph({ text: String(doctor.nightShifts || 0) })] }))
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
