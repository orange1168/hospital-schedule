import { Controller, Post, Body } from '@nestjs/common'
import { ScheduleService, FixedSchedule, SelectedDepartments } from './schedule.service'

interface GenerateScheduleDto {
  startDate: string
  startDutyDoctor: string // 起始值班医生
  selectedDepartments: SelectedDepartments // 每天选择的科室
  fixedSchedule?: FixedSchedule // 固定排班数据
  leaveDoctors?: string[] | { doctor: string; dates: string[] }[] // 请假医生
}

interface DownloadDocDto {
  scheduleData: any
  startDate: string
}

@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  /**
   * 生成排班表（新版本）
   */
  @Post('generate')
  async generateSchedule(@Body() body: GenerateScheduleDto) {
    console.log('收到排班生成请求（新版本）:', body)
    const { startDate, startDutyDoctor, selectedDepartments, fixedSchedule, leaveDoctors } = body

    if (!startDate) {
      return {
        code: 400,
        msg: '请提供开始日期',
        data: null
      }
    }

    if (!startDutyDoctor) {
      return {
        code: 400,
        msg: '请提供起始值班医生',
        data: null
      }
    }

    if (!selectedDepartments) {
      return {
        code: 400,
        msg: '请提供科室选择',
        data: null
      }
    }

    try {
      const scheduleData = await this.scheduleService.generateSchedule(
        startDate,
        startDutyDoctor,
        selectedDepartments,
        fixedSchedule,
        leaveDoctors
      )
      console.log('排班生成成功:', scheduleData)

      return {
        code: 200,
        msg: '排班生成成功',
        data: scheduleData
      }
    } catch (error) {
      console.error('排班生成失败:', error)
      return {
        code: 500,
        msg: '排班生成失败: ' + error.message,
        data: null
      }
    }
  }

  /**
   * 下载Word文档
   */
  @Post('download')
  async downloadDoc(@Body() body: DownloadDocDto) {
    console.log('收到文档下载请求')
    const { scheduleData, startDate } = body

    if (!scheduleData || !startDate) {
      return {
        code: 400,
        msg: '请提供排班数据和开始日期',
        data: null
      }
    }

    try {
      const buffer = await this.scheduleService.exportSchedule(scheduleData)
      const base64 = buffer.toString('base64')

      console.log('文档生成成功，大小:', buffer.length, 'bytes')

      return {
        code: 200,
        msg: '文档生成成功',
        data: {
          fileData: base64,
          fileName: `排班表_${startDate}.docx`
        }
      }
    } catch (error) {
      console.error('文档生成失败:', error)
      return {
        code: 500,
        msg: '文档生成失败: ' + error.message,
        data: null
      }
    }
  }
}
