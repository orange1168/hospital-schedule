import { Injectable } from '@nestjs/common'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun } from 'docx'

export interface ScheduleData {
  dates: string[]
  departments: string[]
  schedule: Record<string, Record<string, string>>
  dutySchedule: Record<string, string>
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
   */
  generateSchedule(startDate: string): ScheduleData {
    const dates = this.getDates(startDate, 7)
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
    this.generateDutySchedule(dates, dutySchedule)

    // 步骤2：生成白班排班
    this.generateDaySchedule(dates, schedule, dutySchedule)

    return {
      dates,
      departments: this.departments,
      schedule,
      dutySchedule
    }
  }

  /**
   * 生成值班表
   * 按医生顺序轮换，记录值班医生和第二天强制休息
   */
  private generateDutySchedule(dates: string[], dutySchedule: Record<string, string>): void {
    let doctorIndex = 0

    dates.forEach((date, index) => {
      // 找到下一个可用的医生
      while (true) {
        const doctor = this.doctors[doctorIndex]
        dutySchedule[date] = doctor
        doctorIndex = (doctorIndex + 1) % this.doctors.length
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
    dutySchedule: Record<string, string>
  ): void {
    // 计算每个医生的工作天数（用于负载均衡）
    const doctorWorkDays: Record<string, number> = {}
    this.doctors.forEach(doctor => {
      doctorWorkDays[doctor] = 0
    })

    // 记录医生的休息日（每周2天 + 值班后的强制休息）
    const doctorRestDays: Record<string, Set<string>> = {}
    this.doctors.forEach(doctor => {
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
          isWeekend ? 3 : 9 // 周末3个科室，工作日9个科室
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
    totalDepartments: number
  ): string[] {
    const available: string[] = []
    const dayOfWeek = new Date(date).getDay()

    this.doctors.forEach(doctor => {
      // 检查是否在休息
      if (doctorRestDays[doctor].has(date)) {
        return
      }

      // 计算该医生本周已工作天数（不包括当天）
      const workDays = doctorWorkDays[doctor]
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
                  text: '白班排班',
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
    scheduleData.dates.forEach(date => {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: date })] })],
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

    scheduleData.dates.forEach(date => {
      headerCells.push(
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: date, bold: true })] })],
          width: { size: (85 / scheduleData.dates.length), type: WidthType.PERCENTAGE },
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
