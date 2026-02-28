import { Controller, Post, Body, Get, UseInterceptors, UploadedFile } from '@nestjs/common'
import { ScheduleService } from './schedule.service'
import { FileInterceptor } from '@nestjs/platform-express'

interface GenerateScheduleDto {
  startDate: string
  doctors?: string[]
  dutyStartDoctor?: string
  leaveRequests?: any[] // ✅ 修改：使用 leaveRequests 匹配前端
  aiRequirements?: string // AI排班需求
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
  generateSchedule(@Body() body: GenerateScheduleDto) {
    console.log('收到排班生成请求:', body)
    const { startDate, doctors, dutyStartDoctor, leaveRequests, aiRequirements } = body

    if (!startDate) {
      return {
        code: 400,
        msg: '请提供开始日期',
        data: null
      }
    }

    try {
      const scheduleData = this.scheduleService.generateSchedule(
        startDate,
        doctors,
        dutyStartDoctor,
        leaveRequests, // ✅ 修改：使用 leaveRequests
        aiRequirements
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
      const buffer = await this.scheduleService.generateWordDoc(scheduleData, startDate)
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

  /**
   * 语音转文字（暂时返回空实现，需要集成ASR服务）
   */
  @Post('speech-to-text')
  @UseInterceptors(FileInterceptor('audio'))
  async speechToText(@UploadedFile() file: any) {
    console.log('收到语音转文字请求，文件:', file?.originalname)

    if (!file) {
      return {
        code: 400,
        msg: '请上传音频文件',
        data: null
      }
    }

    try {
      // TODO: 集成ASR服务进行语音识别
      // 这里暂时返回一个模拟响应
      const text = '李茜必须排在1诊室，姜维周二休息'
      
      console.log('语音识别结果:', text)

      return {
        code: 200,
        msg: '语音识别成功',
        data: {
          text
        }
      }
    } catch (error) {
      console.error('语音识别失败:', error)
      return {
        code: 500,
        msg: '语音识别失败: ' + error.message,
        data: null
      }
    }
  }
}
