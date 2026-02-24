import { Injectable } from '@nestjs/common'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun } from 'docx'

export interface ScheduleData {
  dates: string[]
  datesWithWeek: string[]
  departments: string[]
  schedule: Record<string, Record<string, string>>
  dutySchedule: Record<string, string>
  doctorSchedule: Record<string, Record<string, string>>
}

@Injectable()
export class ScheduleService {
  // 医生列表
  private doctors = Array.from({ length: 14 }, (_, i) => `医生${i + 1}`)
  // 科室列表
  private departments = Array.from({ length: 9 }, (_, i) => `科室${i + 1}`)

  /**
   * 生成排班表
   * @param startDate 开始日期（YYYY-MM-DD）
   * @param doctors 医生列表
   */
  generateSchedule(startDate: string, doctors?: string[]): ScheduleData {
    // 使用用户输入的医生列表，如果没有则使用默认的医生1-医生14
    const doctorList = doctors && doctors.length > 0 ? doctors : this.doctors

    const dates = this.getDates(startDate, 7)
    const datesWithWeek = dates.map(date => this.getDateWithWeek(date))
    const schedule: Record<string, Record<string, string>> = {}
    const dutySchedule: Record<string, string> = {}

    // 初始化排班表结构
    dates.forEach(date => {
      schedule[date] = {}
      this.departments.forEach(dept => {
        schedule[date][dept] = ''
      })
    })

    // 步骤1：生成值班表（优先）
    this.generateDutySchedule(dates, dutySchedule, doctorList)

    // 步骤2：生成白班排班
    this.generateDaySchedule(dates, schedule, dutySchedule, doctorList)

    return {
      dates,
      datesWithWeek,
      departments: this.departments,
      schedule,
      dutySchedule,
      doctorSchedule: {} // 可选：如果需要单独存储医生排班
    }
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
   * 生成值班表
   * 按医生顺序轮换，记录值班医生和第二天强制休息
   */
  private generateDutySchedule(
    dates: string[],
    dutySchedule: Record<string, string>,
    doctorList: string[]
  ): void {
    let doctorIndex = 0

    dates.forEach((date, index) => {
      // 找到下一个可用的医生
      while (true) {
        const doctor = doctorList[doctorIndex % doctorList.length]
        dutySchedule[date] = doctor
        doctorIndex = (doctorIndex + 1) % doctorList.length
        break
      }
    })

    console.log('值班表生成完成:', dutySchedule)
  }

  /**
   * 生成白班排班
   */
  private generateDaySchedule(
    dates: string[],
    schedule: Record<string, Record<string, string>>,
    dutySchedule: Record<string, string>,
    doctorList: string[]
  ): void {
    // 计算每个医生的工作天数（用于负载均衡）
    const doctorWorkDays: Record<string, number> = {}
    doctorList.forEach(doctor => {
      doctorWorkDays[doctor] = 0
    })

    // 记录医生的休息日（每周2天 + 值班后的强制休息）
    const doctorRestDays: Record<string, Set<string>> = {}
    doctorList.forEach(doctor => {
      doctorRestDays[doctor] = new Set()
    })

    // 先计算值班医生的第二天强制休息
    dates.forEach((date, index) => {
      const dutyDoctor = dutySchedule[date]
      const nextDate = index + 1 < dates.length ? dates[index + 1] : null
      if (nextDate && dutyDoctor) {
        doctorRestDays[dutyDoctor].add(nextDate)
      }
    })

    // 为每天分配科室医生
    dates.forEach((date, index) => {
      const dayOfWeek = new Date(date).getDay() // 0=周日, 1=周一, ..., 6=周六
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

      // 周末至少3个科室，工作日9个科室
      const departmentsToAssign = isWeekend
        ? this.departments.slice(0, 3)
        : [...this.departments]

      // 为每个科室分配医生
      departmentsToAssign.forEach(department => {
        const availableDoctors = this.getAvailableDoctors(
          date,
          doctorWorkDays,
          doctorRestDays,
          isWeekend ? 3 : 9, // 周末3个科室，工作日9个科室
          doctorList
        )

        if (availableDoctors.length > 0) {
          // 选择工作天数最少的医生
          const selectedDoctor = this.selectBestDoctor(availableDoctors, doctorWorkDays)
          schedule[date][department] = selectedDoctor
          doctorWorkDays[selectedDoctor]++
        }
      })
    })

    console.log('排班生成完成，各医生工作天数:', doctorWorkDays)
  }

  /**
   * 获取可用的医生列表
   */
  private getAvailableDoctors(
    date: string,
    doctorWorkDays: Record<string, number>,
    doctorRestDays: Record<string, Set<string>>,
    totalDepartments: number,
    doctorList: string[]
  ): string[] {
    const available: string[] = []
    const dayOfWeek = new Date(date).getDay()

    doctorList.forEach(doctor => {
      // 检查是否在休息
      if (doctorRestDays[doctor]?.has(date)) {
        return
      }

      // 计算该医生本周已工作天数（不包括当天）
      const workDays = doctorWorkDays[doctor] || 0
      const maxWorkDays = 5 - totalDepartments / 9 // 根据科室数量调整最大工作天数

      // 工作天数限制（每周最多工作5天，至少休息2天）
      if (workDays >= 5) {
        return
      }

      available.push(doctor)
    })

    return available
  }

  /**
   * 选择最佳医生（工作天数最少）
   */
  private selectBestDoctor(
    availableDoctors: string[],
    doctorWorkDays: Record<string, number>
  ): string {
    let bestDoctor = availableDoctors[0]
    let minWorkDays = doctorWorkDays[bestDoctor]

    availableDoctors.forEach(doctor => {
      if (doctorWorkDays[doctor] < minWorkDays) {
        minWorkDays = doctorWorkDays[doctor]
        bestDoctor = doctor
      }
    })

    return bestDoctor
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
    // 获取医生列表
    const doctorsList = this.getDoctorsList(scheduleData)

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
                  size: 32, // 16pt
                }),
              ],
              spacing: {
                after: 200,
              },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `开始日期：${startDate}`,
                  size: 24,
                }),
              ],
              spacing: {
                after: 200,
              },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: '夜间值班',
                  bold: true,
                  size: 28,
                }),
              ],
              spacing: {
                after: 200,
              },
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
              spacing: {
                before: 400,
                after: 200,
              },
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
              spacing: {
                before: 400,
                after: 200,
              },
            }),
            this.createDoctorScheduleTable(scheduleData, doctorsList),
          ],
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    return buffer
  }

  /**
   * 获取医生列表
   */
  private getDoctorsList(scheduleData: ScheduleData): string[] {
    const doctorsSet = new Set<string>()

    // 从排班表中提取医生
    Object.values(scheduleData.schedule).forEach(daySchedule => {
      Object.values(daySchedule).forEach(doctor => {
        if (doctor && doctor !== '休息') {
          doctorsSet.add(doctor)
        }
      })
    })

    // 添加值班医生
    Object.values(scheduleData.dutySchedule).forEach(doctor => {
      if (doctor) {
        doctorsSet.add(doctor)
      }
    })

    return Array.from(doctorsSet)
  }

  /**
   * 创建值班表
   */
  private createDutyTable(scheduleData: ScheduleData): Table {
    const rows: TableRow[] = []

    // 表头
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: '日期', bold: true })] })],
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: '值班医生', bold: true })] })],
            width: { size: 70, type: WidthType.PERCENTAGE },
          }),
        ],
        tableHeader: true,
      })
    )

    // 数据行
    scheduleData.dates.forEach((date, index) => {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: scheduleData.datesWithWeek[index] })] })],
              width: { size: 30, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: scheduleData.dutySchedule[date] || '未排班', bold: true })],
                }),
              ],
              width: { size: 70, type: WidthType.PERCENTAGE },
            }),
          ],
        })
      )
    })

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left: { style: BorderStyle.SINGLE, size: 1 },
        right: { style: BorderStyle.SINGLE, size: 1 },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
        insideVertical: { style: BorderStyle.SINGLE, size: 1 },
      },
    })
  }

  /**
   * 创建医生排班表
   */
  private createDoctorScheduleTable(scheduleData: ScheduleData, doctorsList: string[]): Table {
    const rows: TableRow[] = []

    // 表头
    const headerCells: TableCell[] = [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: '医生', bold: true })] })],
        width: { size: 15, type: WidthType.PERCENTAGE },
      })
    ]

    scheduleData.datesWithWeek.forEach(date => {
      headerCells.push(
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: date, bold: true })] })],
          width: { size: (85 / scheduleData.datesWithWeek.length), type: WidthType.PERCENTAGE },
        })
      )
    })

    rows.push(new TableRow({
      children: headerCells,
      tableHeader: true,
    }))

    // 数据行
    doctorsList.forEach(doctor => {
      const rowCells: TableCell[] = [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: doctor, bold: true })] })],
          width: { size: 15, type: WidthType.PERCENTAGE },
        }),
      ]

      scheduleData.dates.forEach(date => {
        // 查找该医生当天的科室
        const department = Object.entries(scheduleData.schedule[date] || {})
          .find(([_, doc]) => doc === doctor)?.[0] || null

        // 检查是否是值班
        const isDuty = scheduleData.dutySchedule[date] === doctor

        let cellText = '休息'
        if (isDuty) {
          cellText = '值班'
        } else if (department) {
          cellText = department
        }

        rowCells.push(
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: cellText })] })],
            width: { size: (85 / scheduleData.dates.length), type: WidthType.PERCENTAGE },
          })
        )
      })

      rows.push(new TableRow({
        children: rowCells,
      }))
    })

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left: { style: BorderStyle.SINGLE, size: 1 },
        right: { style: BorderStyle.SINGLE, size: 1 },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
        insideVertical: { style: BorderStyle.SINGLE, size: 1 },
      },
    })
  }

  /**
   * 创建排班表
   */
  private createScheduleTable(scheduleData: ScheduleData): Table {
    const rows: TableRow[] = []

    // 表头
    const headerCells: TableCell[] = [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: '科室', bold: true })] })],
        width: { size: 15, type: WidthType.PERCENTAGE },
      })
    ]

    scheduleData.datesWithWeek.forEach(date => {
      headerCells.push(
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: date, bold: true })] })],
          width: { size: (85 / scheduleData.datesWithWeek.length), type: WidthType.PERCENTAGE },
        })
      )
    })

    rows.push(new TableRow({
      children: headerCells,
      tableHeader: true,
    }))

    // 数据行
    scheduleData.departments.forEach(department => {
      const rowCells: TableCell[] = [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: department, bold: true })] })],
          width: { size: 15, type: WidthType.PERCENTAGE },
        }),
      ]

      scheduleData.dates.forEach(date => {
        const cellValue = scheduleData.schedule[date]?.[department] || '休息'
        rowCells.push(
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: cellValue })] })],
            width: { size: (85 / scheduleData.dates.length), type: WidthType.PERCENTAGE },
          })
        )
      })

      rows.push(new TableRow({
        children: rowCells,
      }))
    })

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left: { style: BorderStyle.SINGLE, size: 1 },
        right: { style: BorderStyle.SINGLE, size: 1 },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
        insideVertical: { style: BorderStyle.SINGLE, size: 1 },
      },
    })
  }
}
