import { Controller, Post, Body } from '@nestjs/common'
import { ScheduleService, FixedSchedule } from './schedule.service'

interface GenerateScheduleDto {
  startDate: string
  departmentNames?: string[] // 科室列表
  doctors?: string[]
  dutyStartDoctor?: string
  leaveRequests?: any[] // ✅ 修改：使用 leaveRequests 匹配前端
  fixedSchedule?: FixedSchedule // 固定排班数据
}

interface DownloadDocDto {
  scheduleData: any
  startDate: string
}

@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  /**
   * 生成排班表
   */
  @Post('generate')
  async generateSchedule(@Body() body: GenerateScheduleDto) {
    console.log('收到排班生成请求:', body)
    const { startDate, departmentNames, doctors, dutyStartDoctor, leaveRequests, fixedSchedule } = body

    console.log('🔴🔴🔴 Controller 收到参数:')
    console.log('  startDate:', startDate)
    console.log('  departmentNames:', departmentNames)
    console.log('  doctors:', doctors)
    console.log('  dutyStartDoctor:', dutyStartDoctor)
    console.log('  fixedSchedule:', fixedSchedule)

    if (!startDate) {
      return {
        code: 400,
        msg: '请提供开始日期',
        data: null
      }
    }

    try {
      const scheduleData = await this.scheduleService.generateSchedule(
        startDate,
        doctors,
        dutyStartDoctor,
        leaveRequests, // ✅ 修改：使用 leaveRequests
        fixedSchedule, // 固定排班数据
        departmentNames // 科室列表
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
      const buffer = await this.scheduleService.generateWordDocument(scheduleData)
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
