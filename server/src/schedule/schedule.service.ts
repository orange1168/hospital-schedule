import { Injectable, BadRequestException } from '@nestjs/common'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun } from 'docx'

// 固定的医生列表（14人）
const FIXED_DOCTORS = [
  '李茜', '姜维', '陈晓林', '高玲', '曹钰', '朱朝霞', '范冬黎', '杨波',
  '李丹', '黄丹', '邬海燕', '罗丹', '彭粤如', '周晓宇'
]

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
  shifts: Record<string, ShiftType> // key: date, value: shift type
  departmentsByDate: Record<string, string> // key: date, value: department name
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

// AI约束接口
interface AiConstraints {
  doctorConstraints: Record<string, { departments: string[]; days: string[]; offDays: string[] }>
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
   * @param doctors 医生列表（可选，不传则使用默认的14位医生）
   * @param dutyStartDoctor 值班起始医生
   * @param leaveDoctors 请假医生列表（字符串数组或对象数组）
   * @param aiRequirements AI排班需求（可选）
   */
  generateSchedule(
    startDate: string,
    doctors?: string[],
    dutyStartDoctor?: string,
    leaveDoctors?: string[] | LeaveInfo[],
    aiRequirements?: string
  ): ScheduleData {
    // 使用用户输入的医生列表，如果没有则使用默认的医生列表
    const doctorList = doctors && doctors.length > 0 ? doctors : FIXED_DOCTORS
    
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
    }

    console.log('开始生成排班，医生列表:', doctorList)
    console.log('值班起始医生:', dutyStartDoctor)
    console.log('请假医生:', leaveMap)
    console.log('AI排班需求:', aiRequirements)

    // 解析AI排班需求
    const aiConstraints = this.parseAiRequirements(aiRequirements || '')
    console.log('解析的AI约束:', aiConstraints)

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
        departmentsByDate: {},
        morningShifts: [],
        afternoonShifts: [],
        morningShiftDays: 0,
        afternoonShiftDays: 0,
        nightShifts: 0,
        restDays: 0
      }
    })

    // 标记夜班后需要休息的医生
    const nextDayOff: Set<string> = new Set()

    // 检查医生在特定日期是否请假
    const isDoctorOnLeave = (doctor: string, date: string): boolean => {
      if (!leaveMap[doctor]) return false
      // 如果 dates 数组为空，表示该医生一周都请假
      if (leaveMap[doctor].length === 0) return true
      // 检查指定日期是否在请假列表中
      return leaveMap[doctor].includes(date)
    }

    // 检查医生是否在AI约束中指定了休息日
    const isDoctorOffByAi = (doctor: string, date: string): boolean => {
      const constraint = aiConstraints.doctorConstraints[doctor]
      if (!constraint || !constraint.offDays) return false
      
      // 获取日期的星期
      const dateObj = new Date(date)
      const dayOfWeek = dateObj.getDay()
      const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      const dayName = dayNames[dayOfWeek]
      
      return constraint.offDays.includes(dayName)
    }

    // 检查医生在AI约束中是否必须排某个科室
    const getRequiredDepartment = (doctor: string, date: string): string | null => {
      const constraint = aiConstraints.doctorConstraints[doctor]
      if (!constraint || !constraint.departments || constraint.departments.length === 0) {
        return null
      }
      
      // 如果AI要求每天都排某个科室，则返回第一个科室
      // 实际应用中可以根据日期或其他条件判断
      return constraint.departments[0]
    }

    // 步骤1：分配夜班
    this.assignNightShifts(
      dates,
      dutySchedule,
      availableDoctors,
      dutyStartDoctor,
      nextDayOff,
      doctorSchedule,
      isDoctorOnLeave
    )

    // 步骤2：分配上午和下午班次
    this.assignDayShifts(
      dates,
      schedule,
      nextDayOff,
      availableDoctors,
      doctorSchedule,
      isDoctorOnLeave,
      isDoctorOffByAi,
      getRequiredDepartment
    )

    // 步骤3：检查每个医生的休息天数
    const failedDoctors = this.validateRestDays(doctorSchedule, dates)
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
      useHalfDay: false // 暂时没有实现半天排班
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
    nextDayOff: Set<string>,
    doctorSchedule: Record<string, DoctorSchedule>,
    isDoctorOnLeave: (doctor: string, date: string) => boolean
  ): void {
    // 找到值班起始医生在 FIXED_DOCTORS 中的索引
    let startIndex = 0
    if (dutyStartDoctor && FIXED_DOCTORS.includes(dutyStartDoctor)) {
      startIndex = FIXED_DOCTORS.indexOf(dutyStartDoctor)
    }

    let doctorIndex = startIndex

    dates.forEach((date, index) => {
      // 找到下一个可用的医生（跳过请假医生和第二天需要休息的医生）
      let attempts = 0
      let selectedDoctor = ''
      
      while (attempts < FIXED_DOCTORS.length * 2) {
        const doctor = FIXED_DOCTORS[doctorIndex % FIXED_DOCTORS.length]
        
        // 检查医生是否在可用医生列表中，并且没有请假或第二天需要休息
        if (
          availableDoctors.includes(doctor) &&
          !isDoctorOnLeave(doctor, date) &&
          !nextDayOff.has(doctor)
        ) {
          selectedDoctor = doctor
          break
        }
        
        doctorIndex++
        attempts++
      }

      // 如果在 FIXED_DOCTORS 中找不到，则在 availableDoctors 中找
      if (!selectedDoctor && availableDoctors.length > 0) {
        let availableIndex = 0
        while (attempts < availableDoctors.length * 2) {
          const doctor = availableDoctors[availableIndex % availableDoctors.length]
          
          if (
            !isDoctorOnLeave(doctor, date) &&
            !nextDayOff.has(doctor)
          ) {
            selectedDoctor = doctor
            break
          }
          
          availableIndex++
          attempts++
        }
      }

      if (!selectedDoctor) {
        // 如果没有找到合适的医生，选择第一个可用的
        selectedDoctor = availableDoctors[0]
      }

      dutySchedule[date] = selectedDoctor
      doctorSchedule[selectedDoctor].shifts[date] = 'night'
      doctorSchedule[selectedDoctor].departmentsByDate[date] = '值班' // 记录为值班
      doctorSchedule[selectedDoctor].nightShifts++

      // 🔴 CRITICAL: 标记第二天需要休息
      if (index + 1 < dates.length) {
        nextDayOff.add(selectedDoctor)
        console.log(`${date} 夜班医生 ${selectedDoctor}，${dates[index + 1]} 强制休息`)
      }

      doctorIndex++
    })

    console.log('夜班分配完成:', dutySchedule)
    console.log('nextDayOff:', Array.from(nextDayOff))
  }

  /**
   * 分配上午和下午班次
   */
  private assignDayShifts(
    dates: string[],
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    nextDayOff: Set<string>,
    availableDoctors: string[],
    doctorSchedule: Record<string, DoctorSchedule>,
    isDoctorOnLeave: (doctor: string, date: string) => boolean,
    isDoctorOffByAi: (doctor: string, date: string) => boolean,
    getRequiredDepartment: (doctor: string, date: string) => string | null
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

    dates.forEach((date, dateIndex) => {
      // 🔴 CRITICAL: 在循环开始时，将 nextDayOff 中的医生标记为休息
      nextDayOff.forEach(doctor => {
        doctorSchedule[doctor].shifts[date] = 'off'
        console.log(`${date} ${doctor} 因前一天夜班而强制休息`)
      })

      // 清空 nextDayOff，以便在分配夜班后重新填充
      nextDayOff.clear()

      const doctorsOff = Array.from(nextDayOff)
      const doctorsWorking = availableDoctors.filter(d => 
        !doctorsOff.includes(d) && 
        !isDoctorOnLeave(d, date) &&
        doctorSchedule[d].shifts[date] !== 'night' &&
        doctorSchedule[d].shifts[date] !== 'off' && // 🔴 排除已经标记为休息的医生
        !isDoctorOffByAi(d, date) // 🔴 排除AI约束指定休息的医生
      )

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

      departmentsForDay.forEach(dept => {
        if (doctorsWorking.length > 0) {
          // 🔴 优先分配AI约束的医生
          let bestDoctor = ''
          let minWorkDays = Infinity

          // 首先检查是否有AI约束要求某个医生必须排这个科室
          for (const doctor of availableDoctors) {
            const requiredDept = getRequiredDepartment(doctor, date)
            if (requiredDept === dept && 
                doctorsWorking.includes(doctor) &&
                !doctorSchedule[doctor].shifts[date]) {
              bestDoctor = doctor
              console.log(`${date} ${dept} AI约束: ${doctor} 必须排此科室`)
              break
            }
          }

          // 如果没有AI约束，则选择工作天数最少的医生
          if (!bestDoctor) {
            for (const doctor of doctorsWorking) {
              // 检查这个医生今天是否已经排班
              if (!doctorSchedule[doctor].shifts[date] || doctorSchedule[doctor].shifts[date] === 'off') {
                if (doctorWorkDays[doctor] < minWorkDays) {
                  minWorkDays = doctorWorkDays[doctor]
                  bestDoctor = doctor
                }
              }
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

            doctorSchedule[bestDoctor].shifts[date] = 'morning'
            doctorSchedule[bestDoctor].departmentsByDate[date] = dept // 记录科室
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
      // 🔴 注意：不再在这里清空 nextDayOff，因为已经在循环开始时清空了
    })

    // 计算上午班和下午班的天数
    Object.values(doctorSchedule).forEach(info => {
      // 统计上午班天数
      const morningDays = new Set<string>()
      dates.forEach(date => {
        if (info.shifts[date] === 'morning') {
          morningDays.add(date)
        }
      })
      info.morningShiftDays = morningDays.size

      // 统计下午班天数（下午班和上午班同一天）
      const afternoonDays = new Set<string>()
      dates.forEach(date => {
        if (info.shifts[date] === 'morning') {
          afternoonDays.add(date)
        }
      })
      info.afternoonShiftDays = afternoonDays.size
    })

    console.log('日班分配完成，各医生工作天数:', doctorWorkDays)
  }

  /**
   * 验证休息天数
   */
  private validateRestDays(
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[]
  ): string[] {
    const failedDoctors: string[] = []

    Object.values(doctorSchedule).forEach(info => {
      let restDays = 0
      dates.forEach(date => {
        if (info.shifts[date] === 'off') {
          restDays++
        }
      })

      if (restDays < 1) {
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
        if (info.shifts[date] === 'off') {
          restDays++
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

  /**
   * 解析AI排班需求
   * @param requirements AI需求文本
   * @returns 解析后的约束条件
   */
  private parseAiRequirements(requirements: string): AiConstraints {
    const result: AiConstraints = {
      doctorConstraints: {}
    }

    if (!requirements.trim()) {
      return result
    }

    // 简单规则解析（实际应用中可以使用LLM进行更复杂的解析）
    const lines = requirements.split(/[。,，\n]/).filter(line => line.trim())

    lines.forEach(line => {
      const trimmedLine = line.trim()
      
      // 解析"医生必须每天在科室"的规则
      const mustEveryDayInDeptMatch = trimmedLine.match(/(.+?)必须每天(在)?(.+?诊室)/)
      if (mustEveryDayInDeptMatch) {
        const doctor = mustEveryDayInDeptMatch[1].trim()
        const department = mustEveryDayInDeptMatch[3].trim()
        
        console.log(`解析到AI约束: ${doctor} 必须每天在 ${department}`)
        
        if (!result.doctorConstraints[doctor]) {
          result.doctorConstraints[doctor] = { departments: [], days: [], offDays: [] }
        }
        result.doctorConstraints[doctor].departments.push(department)
      }

      // 解析"医生必须在科室"的规则
      const mustInDeptMatch = trimmedLine.match(/(.+?)必须(在)?(.+?诊室)/)
      if (mustInDeptMatch && !trimmedLine.includes('每天')) {
        const doctor = mustInDeptMatch[1].trim()
        const department = mustInDeptMatch[3].trim()
        
        console.log(`解析到AI约束: ${doctor} 必须在 ${department}`)
        
        if (!result.doctorConstraints[doctor]) {
          result.doctorConstraints[doctor] = { departments: [], days: [], offDays: [] }
        }
        result.doctorConstraints[doctor].departments.push(department)
      }

      // 解析"医生某天休息"的规则
      const restDayMatch = trimmedLine.match(/(.+?)(周一|周二|周三|周四|周五|周六|周日)休息/)
      if (restDayMatch) {
        const doctor = restDayMatch[1].trim()
        const dayOfWeek = restDayMatch[2].trim()
        
        console.log(`解析到AI约束: ${doctor} ${dayOfWeek} 休息`)
        
        if (!result.doctorConstraints[doctor]) {
          result.doctorConstraints[doctor] = { departments: [], days: [], offDays: [] }
        }
        result.doctorConstraints[doctor].offDays.push(dayOfWeek)
      }
    })

    return result
  }
}
