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
   * @param doctors 医生列表
   * @param dutyStartDoctor 值班起始医生
   * @param leaveDoctors 请假医生列表（字符串数组或对象数组）
   */
  generateSchedule(
    startDate: string,
    doctors?: string[],
    dutyStartDoctor?: string,
    leaveDoctors?: string[] | LeaveInfo[]
  ): ScheduleData {
    // 使用用户输入的医生列表，如果没有则使用默认的医生列表
    const doctorList = doctors && doctors.length > 0 ? doctors : []
    
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
      isDoctorOnLeave
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

      // 标记第二天需要休息
      if (index + 1 < dates.length) {
        nextDayOff.add(selectedDoctor)
      }

      doctorIndex++
    })

    console.log('夜班分配完成:', dutySchedule)
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
    isDoctorOnLeave: (doctor: string, date: string) => boolean
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
      const doctorsOff = Array.from(nextDayOff)
      const doctorsWorking = availableDoctors.filter(d => 
        !doctorsOff.includes(d) && 
        !isDoctorOnLeave(d, date) &&
        doctorSchedule[d].shifts[date] !== 'night'
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

      departmentsForDay.forEach(dept => {
        if (doctorsWorking.length > 0) {
          // 从今天还未排班的医生中，选择工作天数最少的医生
          let bestDoctor = ''
          let minWorkDays = Infinity

          doctorsWorking.forEach(doctor => {
            // 检查这个医生今天是否已经排班
            if (!doctorSchedule[doctor].shifts[date] || doctorSchedule[doctor].shifts[date] === 'off') {
              if (doctorWorkDays[doctor] < minWorkDays) {
                minWorkDays = doctorWorkDays[doctor]
                bestDoctor = doctor
              }
            }
          })

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
          }
        }
      })

      // 清除第二天的休息标记
      nextDayOff.clear()
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

    Object.values(doctorSchedule).forEach(doctorInfo => {
      const restDays = dates.filter(date => {
        const shift = doctorInfo.shifts[date]
        return shift === 'off' || !shift
      }).length

      if (restDays === 0) {
        failedDoctors.push(doctorInfo.name)
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
    Object.values(doctorSchedule).forEach(doctorInfo => {
      const restDays = dates.filter(date => {
        const shift = doctorInfo.shifts[date]
        return shift === 'off' || !shift
      }).length
      doctorInfo.restDays = restDays
    })
  }

  /**
   * 获取日期和星期
   */
  private getDateWithWeek(date: string): string {
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const dateObj = new Date(date)
    const weekDay = weekDays[dateObj.getDay()]
    return `${date} ${weekDay}`
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
   * 生成Word文档
   */
  async generateWordDoc(scheduleData: ScheduleData, startDate: string): Promise<Buffer> {
    const doctorsList = Object.keys(scheduleData.doctorSchedule)

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: '医院排班表',
                  bold: true,
                  size: 32,
                }),
              ],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `开始日期：${startDate}`,
                  size: 24,
                }),
              ],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: '夜间值班',
                  bold: true,
                  size: 28,
                }),
              ],
              spacing: { after: 200 },
            }),
            this.createDutyTable(scheduleData),
            new Paragraph({
              children: [
                new TextRun({
                  text: '白班排班（科室）',
                  bold: true,
                  size: 28,
                }),
              ],
              spacing: { before: 400, after: 200 },
            }),
            this.createScheduleTable(scheduleData),
            new Paragraph({
              children: [
                new TextRun({
                  text: '医生排班',
                  bold: true,
                  size: 28,
                }),
              ],
              spacing: { before: 400, after: 200 },
            }),
            this.createDoctorScheduleTable(scheduleData),
            new Paragraph({
              children: [
                new TextRun({
                  text: '医生排班统计',
                  bold: true,
                  size: 28,
                }),
              ],
              spacing: { before: 400, after: 200 },
            }),
            this.createDoctorStatsTable(scheduleData),
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
  private createDutyTable(scheduleData: ScheduleData): Table {
    const { dates, dutySchedule } = scheduleData

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '日期', bold: true })] }),
              ],
              width: { size: 30, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '值班医生', bold: true })] }),
              ],
              width: { size: 70, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
        ...dates.map(
          (date) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(date)] })],
                  width: { size: 30, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun(
                          dutySchedule[date] || '-'
                        ),
                      ],
                    }),
                  ],
                  width: { size: 70, type: WidthType.PERCENTAGE },
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
   * 创建医生排班表
   */
  private createDoctorScheduleTable(scheduleData: ScheduleData): Table {
    const { dates, datesWithWeek, doctorSchedule } = scheduleData

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        // 表头
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '医生', bold: true })] }),
              ],
              width: { size: 15, type: WidthType.PERCENTAGE },
            }),
            ...dates.map(
              (date) =>
                new TableCell({
                  children: [
                    new Paragraph({ children: [new TextRun({ text: date, bold: true })] }),
                  ],
                  width: { size: 85 / dates.length, type: WidthType.PERCENTAGE },
                })
            ),
          ],
        }),
        // 数据行
        ...Object.values(doctorSchedule).map(
          (info) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(info.name)] })],
                  width: { size: 15, type: WidthType.PERCENTAGE },
                }),
                ...dates.map(
                  (date) => {
                    const shift = info.shifts[date]
                    const department = info.departmentsByDate[date]
                    let shiftText = '-'
                    
                    if (shift === 'night') {
                      shiftText = `${department || '值班'} 夜班`
                    } else if (shift === 'morning') {
                      shiftText = department || '休息'
                    }

                    return new TableCell({
                      children: [new Paragraph({ children: [new TextRun(shiftText)] })],
                      width: { size: 85 / dates.length, type: WidthType.PERCENTAGE },
                    })
                  }
                ),
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

  /**
   * 创建排班表
   */
  private createScheduleTable(scheduleData: ScheduleData): Table {
    const { dates, departments, schedule } = scheduleData

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        // 表头
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: '日期', bold: true })] }),
              ],
              width: { size: 15, type: WidthType.PERCENTAGE },
            }),
            ...departments.map(
              (dept) =>
                new TableCell({
                  children: [
                    new Paragraph({ children: [new TextRun({ text: dept, bold: true })] }),
                  ],
                  width: { size: 85 / departments.length, type: WidthType.PERCENTAGE },
                })
            ),
          ],
        }),
        // 数据行
        ...dates.map(
          (date) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(date)] })],
                  width: { size: 15, type: WidthType.PERCENTAGE },
                }),
                ...departments.map(
                  (dept) => {
                    const slots = schedule[date]?.[dept] || []
                    const doctors = slots.map(s => {
                      const suffix = s.shift === 'morning' ? '（上午）' : '（下午）'
                      return `${s.doctor}${suffix}`
                    }).join('、')
                    return new TableCell({
                      children: [new Paragraph({ children: [new TextRun(doctors || '-')] })],
                      width: { size: 85 / departments.length, type: WidthType.PERCENTAGE },
                    })
                  }
                ),
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
