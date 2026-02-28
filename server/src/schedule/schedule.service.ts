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
  nightShiftsByDate: Record<string, boolean> // key: date, value: 是否有夜班
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
   * @param doctors 医生列表（可以是字符串数组或对象数组）
   * @param dutyStartDoctor 值班起始医生
   * @param leaveDoctors 请假医生列表（字符串数组或对象数组）
   * @param aiRequirements AI排班需求（可选）
   */
  generateSchedule(
    startDate: string,
    doctors?: string[] | { name: string; isMainDuty?: boolean }[],
    dutyStartDoctor?: string,
    leaveDoctors?: string[] | LeaveInfo[],
    aiRequirements?: string
  ): ScheduleData {
    console.log('🔥 generateSchedule 被调用，startDate:', startDate)

    // 将医生列表转换为字符串数组
    const doctorList = doctors && doctors.length > 0
      ? doctors.map(d => typeof d === 'string' ? d : d.name)
      : FIXED_DOCTORS
    
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
      console.log('请假信息:', leaveMap)
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
        nightShiftsByDate: {},
        departmentsByDate: {},
        morningShifts: [],
        afternoonShifts: [],
        morningShiftDays: 0,
        afternoonShiftDays: 0,
        nightShifts: 0,
        restDays: 0
      }
    })

    // 检查医生在特定日期是否请假
    const isDoctorOnLeave = (doctor: string, date: string): boolean => {
      const isLeave = !leaveMap[doctor] ? false : (leaveMap[doctor].length === 0 || leaveMap[doctor].includes(date))
      console.log(`🔴检查 ${doctor} 在 ${date} 是否请假: ${isLeave}, leaveMap[${doctor}] = ${leaveMap[doctor]}`)
      return isLeave
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

    // 🔴 CRITICAL: 先定义 restDatesMap，让 assignNightShifts 直接更新它
    // key: date, value: Set<doctor>
    const restDatesMap: Record<string, Set<string>> = {}

    // 步骤1：分配夜班（同时更新 restDatesMap）
    console.log('开始分配夜班...')
    this.assignNightShifts(
      dates,
      dutySchedule,
      availableDoctors,
      dutyStartDoctor,
      doctorSchedule,
      isDoctorOnLeave,
      restDatesMap // 🔴 传递 restDatesMap 参数
    )

    console.log('🔴 restDatesMap 内容:')
    Object.entries(restDatesMap).forEach(([date, doctors]) => {
      console.log(`${date}: ${Array.from(doctors).join(', ')}`)
    })

    // 步骤2：分配上午和下午班次
    console.log('开始分配白班...')
    this.assignDayShifts(
      dates,
      schedule,
      dutySchedule, // ✅ 添加 dutySchedule 参数
      restDatesMap,
      availableDoctors,
      doctorSchedule,
      isDoctorOnLeave,
      isDoctorOffByAi,
      getRequiredDepartment
    )

    // 步骤3：检查每个医生的休息天数（考虑AI约束）
    const failedDoctors = this.validateRestDays(doctorSchedule, dates, aiConstraints, availableDoctors)
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
    doctorSchedule: Record<string, DoctorSchedule>,
    isDoctorOnLeave: (doctor: string, date: string) => boolean,
    restDatesMap: Record<string, Set<string>> // 🔴 添加 restDatesMap 参数
  ): void {
    // 找到值班起始医生在 FIXED_DOCTORS 中的索引
    let startIndex = 0
    if (dutyStartDoctor && FIXED_DOCTORS.includes(dutyStartDoctor)) {
      startIndex = FIXED_DOCTORS.indexOf(dutyStartDoctor)
    }

    // 🔴 CRITICAL: 基于可用医生列表进行轮换，而不是 FIXED_DOCTORS
    // 避免因医生数量不一致导致的索引错误
    let doctorIndex = 0
    if (dutyStartDoctor && availableDoctors.includes(dutyStartDoctor)) {
      doctorIndex = availableDoctors.indexOf(dutyStartDoctor)
      console.log(`🔴 值班起始医生设置为: ${dutyStartDoctor}, 索引: ${doctorIndex}`)
    }

    // 🔴 CRITICAL: 记录每个医生不能值班的剩余天数（确保至少休息2天）
    const doctorDutyBlockDays: Record<string, number> = {}

    // 🔴 CRITICAL: 计算最后一个值班日期（确保至少能在倒数第3天值班，这样能休息倒数第2天和倒数第1天）
    const lastDutyDateIndex = dates.length - 3 // 倒数第3天（索引 = dates.length - 3）
    console.log(`🔴 最后一个值班日期索引: ${lastDutyDateIndex} (日期: ${dates[lastDutyDateIndex]})`)

    dates.forEach((date, index) => {
      // 🔴 CRITICAL: 如果超过了最后一个值班日期，不安排值班
      // 这样可以确保最后一个值班医生至少能休息2天
      if (index > lastDutyDateIndex) {
        console.log(`🔴 ${date} 超过了最后一个值班日期（索引 ${index} > ${lastDutyDateIndex}），不安排值班`)
        dutySchedule[date] = '' // 不安排值班
        doctorIndex++ // 继续递增索引，避免值班顺序被打乱
        return
      }

      // 🔴 CRITICAL: 每天开始前，减少所有医生的不能值班天数
      Object.keys(doctorDutyBlockDays).forEach(doctor => {
        if (doctorDutyBlockDays[doctor] > 0) {
          doctorDutyBlockDays[doctor]--
          console.log(`🔴 ${doctor} 剩余不能值班天数: ${doctorDutyBlockDays[doctor]}`)
        }
      })

      // 找到下一个可用的医生（跳过请假医生和不能值班的医生）
      let attempts = 0
      let selectedDoctor = ''

      // 🔴 CRITICAL: 在可用医生列表中循环选择，而不是 FIXED_DOCTORS
      while (attempts < availableDoctors.length * 2) {
        const doctor = availableDoctors[doctorIndex % availableDoctors.length]
        const isOnLeave = isDoctorOnLeave(doctor, date)
        const blockDays = doctorDutyBlockDays[doctor] || 0

        console.log(`🔴值班检查 ${date}: 医生=${doctor}, 请假=${isOnLeave}, 不能值班天数=${blockDays}`)

        // 🔴 CRITICAL: 必须排除不能值班的医生（至少休息2天）
        if (!isOnLeave && blockDays === 0) {
          selectedDoctor = doctor
          console.log(`🔴值班选择 ${date}: ${selectedDoctor}`)
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
          const blockDays = doctorDutyBlockDays[doctor] || 0

          if (!isDoctorOnLeave(doctor, date) && blockDays === 0) {
            selectedDoctor = doctor
            break
          }

          availableIndex++
          attempts++
        }
      }

      if (!selectedDoctor) {
        // 如果没有找到合适的医生，在可用医生中找一个没有请假的
        console.warn(`${date} 没有找到合适的值班医生，尝试从可用医生中选择`)
        for (const doctor of availableDoctors) {
          if (!isDoctorOnLeave(doctor, date)) {
            selectedDoctor = doctor
            console.log(`${date} 选择值班医生: ${selectedDoctor} (fallback)`)
            break
          }
        }

        // 如果还是没有找到，抛出异常
        if (!selectedDoctor) {
          throw new BadRequestException(`${date} 没有可用的值班医生（所有可用医生都请假）`)
        }
      }

      dutySchedule[date] = selectedDoctor
      doctorSchedule[selectedDoctor].nightShiftsByDate[date] = true // 标记有夜班
      // 🔴 CRITICAL: 不设置 shifts[date]，让白班分配时设置为 'morning'
      // doctorSchedule[selectedDoctor].shifts[date] = 'night' // 移除这行
      doctorSchedule[selectedDoctor].departmentsByDate[date] = '值班' // 记录为值班
      doctorSchedule[selectedDoctor].nightShifts++

      // 🔴 CRITICAL: 标记该医生不能在接下来2天内值班（至少休息2天）
      // 第2天不能值班（休息）
      if (index + 1 < dates.length) {
        const nextDate = dates[index + 1]
        if (!restDatesMap[nextDate]) {
          restDatesMap[nextDate] = new Set()
        }
        restDatesMap[nextDate].add(selectedDoctor)
        console.log(`${date} 夜班医生 ${selectedDoctor}，${nextDate} 强制休息（第1天）`)
      }
      // 第3天不能值班（休息）
      if (index + 2 < dates.length) {
        const nextNextDate = dates[index + 2]
        if (!restDatesMap[nextNextDate]) {
          restDatesMap[nextNextDate] = new Set()
        }
        restDatesMap[nextNextDate].add(selectedDoctor)
        console.log(`${date} 夜班医生 ${selectedDoctor}，${nextNextDate} 强制休息（第2天）`)
      }

      // 🔴 CRITICAL: 设置该医生不能值班的剩余天数为2
      doctorDutyBlockDays[selectedDoctor] = 2
      console.log(`${date} 夜班医生 ${selectedDoctor}，接下来2天不能值班`)

      doctorIndex++
    })

    console.log('🔴 restDatesMap 内容:')
    Object.entries(restDatesMap).forEach(([date, doctors]) => {
      console.log(`  ${date}: ${Array.from(doctors).join(', ')}`)
    })

    // 🔴 CRITICAL: 验证值班医生的休息日设置
    dates.forEach((date, index) => {
      const dutyDoctor = dutySchedule[date]
      if (dutyDoctor && index + 1 < dates.length) {
        const nextDate = dates[index + 1]
        const nextNextDate = index + 2 < dates.length ? dates[index + 2] : null
        console.log(`🔴 ${date} 值班医生 ${dutyDoctor}，应该休息的日期: ${nextDate}${nextNextDate ? ', ' + nextNextDate : ''}`)
        console.log(`  ${nextDate} restDatesMap: ${Array.from(restDatesMap[nextDate] || [])}`)
        if (nextNextDate) {
          console.log(`  ${nextNextDate} restDatesMap: ${Array.from(restDatesMap[nextNextDate] || [])}`)
        }
      }
    })
  }

  /**
   * 分配上午和下午班次
   */
  private assignDayShifts(
    dates: string[],
    schedule: Record<string, Record<string, ScheduleSlot[]>>,
    dutySchedule: Record<string, string>, // ✅ 添加 dutySchedule 参数
    restDatesMap: Record<string, Set<string>>,
    availableDoctors: string[],
    doctorSchedule: Record<string, DoctorSchedule>,
    isDoctorOnLeave: (doctor: string, date: string) => boolean,
    isDoctorOffByAi: (doctor: string, date: string) => boolean,
    getRequiredDepartment: (doctor: string, date: string) => string | null
  ): void {
    // ✅ 新增：预先给非夜班医生分配休息日，确保所有医生都有至少1天休息
    const restAssigned: Set<string> = new Set() // 已分配休息的医生
    const nightDoctors: Set<string> = new Set() // 夜班医生集合
    
    // 收集所有夜班医生
    Object.values(doctorSchedule).forEach(info => {
      if (info.nightShifts > 0) {
        nightDoctors.add(info.name)
      }
    })
    
    // 随机给非夜班医生分配休息日（确保每人至少1天）
    const nonNightDoctors = availableDoctors.filter(doc => !nightDoctors.has(doc))
    if (nonNightDoctors.length > 0) {
      // 随机打乱顺序
      const shuffled = [...nonNightDoctors].sort(() => Math.random() - 0.5)
      
      // 从第3天开始分配休息日（避开夜班医生的休息日高峰）
      let restDayIndex = 2
      shuffled.forEach(doctor => {
        // 找到可用的工作日（不是夜班医生的休息日）
        while (restDayIndex < dates.length) {
          const restDate = dates[restDayIndex]
          const restSet = restDatesMap[restDate] || new Set()
          
          // 检查这天是否已经有太多休息医生（避免某天休息人数过多）
          const totalRestToday = (restDatesMap[restDate]?.size || 0) + 1
          
          if (totalRestToday <= 3) { // 每天最多3人休息
            if (!restDatesMap[restDate]) {
              restDatesMap[restDate] = new Set()
            }
            restDatesMap[restDate].add(doctor)
            restAssigned.add(doctor)
            console.log(`预先分配：${doctor} 在 ${restDate} 休息`)
            restDayIndex = (restDayIndex + 1) % dates.length
            break
          }
          restDayIndex = (restDayIndex + 1) % dates.length
        }
      })
    }

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
      // 🔴 CRITICAL: 标记当天需要休息的医生
      const todayOff = restDatesMap[date] || new Set()
      console.log(`🔴 ${date} 需要休息的医生: ${Array.from(todayOff).join(', ') || '无'}`)
      todayOff.forEach(doctor => {
        doctorSchedule[doctor].shifts[date] = 'off'
        console.log(`  ${date} ${doctor} 设置为休息`)
      })

      const doctorsWorking = availableDoctors.filter(d => 
        !todayOff.has(d) && 
        !isDoctorOnLeave(d, date) &&
        !isDoctorOffByAi(d, date) &&
        doctorSchedule[d].shifts[date] !== 'off' // 🔴 排除已标记为休息的医生
      )

      // 🔴 CRITICAL: 检查是否有值班医生在休息日被错误包含在工作列表中
      const dutyDoctor = dutySchedule[date]
      if (dutyDoctor && dateIndex > 0) {
        const prevDate = dates[dateIndex - 1]
        const prevDutyDoctor = dutySchedule[prevDate]
        
        // 检查前一天值班的医生是否在今天的休息名单中，但却在工作列表中
        if (prevDutyDoctor && todayOff.has(prevDutyDoctor)) {
          if (doctorsWorking.includes(prevDutyDoctor)) {
            console.log(`⚠️ 警告: ${prevDutyDoctor} 在 ${date} 应该休息（前一天值班），但仍在工作列表中！`)
          }
        }
      }

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

      departmentsForDay.forEach((dept, deptIndex) => {
        if (doctorsWorking.length > 0) {
          // ✅ 优先分配值班医生到第一个科室
          let bestDoctor = ''
          const dutyDoctor = dutySchedule[date] // 获取当天的值班医生
          
          console.log(`🔴 ${date} ${dept}: 值班医生=${dutyDoctor}, 是否值班医生= ${dutyDoctor ? '是' : '否'}, 科室索引=${deptIndex}`)
          
          // 如果是第一个科室，且有值班医生在工作列表中，且还没排班，则优先分配
          if (deptIndex === 0 && dutyDoctor && 
              doctorsWorking.includes(dutyDoctor) && 
              !doctorSchedule[dutyDoctor].shifts[date]) {
            bestDoctor = dutyDoctor
            console.log(`${date} ${dept} 优先分配值班医生: ${bestDoctor}`)
          }
          
          // 如果不是值班医生，则按照原来的逻辑分配
          if (!bestDoctor) {
            // 🔴 优先分配AI约束的医生
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
              // 找出所有工作天数最少且当天没有排班的医生
              const candidates: string[] = []
              for (const doctor of doctorsWorking) {
                // 检查这个医生今天是否已经排过白班（不包括夜班）
                const alreadyHasDayShift = doctorSchedule[doctor].shifts[date] && 
                                           doctorSchedule[doctor].shifts[date] !== 'off'
                
                if (!alreadyHasDayShift) {
                  if (doctorWorkDays[doctor] < minWorkDays) {
                    minWorkDays = doctorWorkDays[doctor]
                    candidates.length = 0 // 清空候选列表
                  }
                  if (doctorWorkDays[doctor] === minWorkDays) {
                    candidates.push(doctor)
                  }
                }
              }
              
              // 随机选择一个候选医生
              if (candidates.length > 0) {
                bestDoctor = candidates[Math.floor(Math.random() * candidates.length)]
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

            // 🔴 CRITICAL: 设置白班状态
            doctorSchedule[bestDoctor].shifts[date] = 'morning'
            doctorSchedule[bestDoctor].departmentsByDate[date] = dept // 记录科室
            doctorSchedule[bestDoctor].morningShifts.push(dept)
            doctorSchedule[bestDoctor].afternoonShifts.push(dept)
            
            // 统计天数：如果这个医生今天还没排过班，则天数+1
            if (!doctorDailyWork[bestDoctor].has(date)) {
              doctorDailyWork[bestDoctor].add(date)
              doctorWorkDays[bestDoctor]++
            }
            
            // ✅ 新增：如果医生工作天数达到5天，强制安排下一天休息
            if (doctorWorkDays[bestDoctor] >= 5 && dateIndex + 1 < dates.length) {
              const nextDate = dates[dateIndex + 1]
              if (!restDatesMap[nextDate]) {
                restDatesMap[nextDate] = new Set()
              }
              restDatesMap[nextDate].add(bestDoctor)
              console.log(`${bestDoctor} 工作满5天，${nextDate} 强制休息`)
            }
            
            console.log(`${date} ${dept} 分配给 ${bestDoctor} ${doctorSchedule[bestDoctor].nightShiftsByDate[date] ? '(夜班)' : ''}`)
          } else {
            console.log(`${date} ${dept} 没有找到合适的医生`)
          }
        }
      })
    })

    // 计算上午班和下午班的天数
    Object.values(doctorSchedule).forEach(info => {
      // 统计上午班天数（排除值班当天）
      const morningDays = new Set<string>()
      dates.forEach(date => {
        // 🔴 CRITICAL: 值班当天不计入上午班天数
        if (info.shifts[date] === 'morning' && !info.nightShiftsByDate[date]) {
          morningDays.add(date)
        }
      })
      info.morningShiftDays = morningDays.size

      // 统计下午班天数（下午班和上午班同一天，排除值班当天）
      const afternoonDays = new Set<string>()
      dates.forEach(date => {
        // 🔴 CRITICAL: 值班当天不计入下午班天数
        if (info.shifts[date] === 'morning' && !info.nightShiftsByDate[date]) {
          afternoonDays.add(date)
        }
      })
      info.afternoonShiftDays = afternoonDays.size
    })

    console.log('日班分配完成，各医生工作天数:', doctorWorkDays)

    // 🔴 CRITICAL: 打印值班医生的排班详情
    console.log('🔴 值班医生排班详情:')
    dates.forEach((date, index) => {
      const dutyDoctor = dutySchedule[date]
      if (dutyDoctor) {
        console.log(`  ${date} 值班: ${dutyDoctor}, shifts[${date}] = ${doctorSchedule[dutyDoctor].shifts[date]}, departmentsByDate[${date}] = ${(doctorSchedule[dutyDoctor] as any).departmentsByDate[date]}`)
      }
    })
  }

  /**
   * 验证休息天数（考虑AI约束）
   */
  private validateRestDays(
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[],
    aiConstraints: AiConstraints,
    availableDoctors: string[]  // 只验证可用医生的休息天数
  ): string[] {
    const failedDoctors: string[] = []

    // 只验证可用医生（不包括请假医生）
    availableDoctors.forEach(doctorName => {
      const info = doctorSchedule[doctorName]
      if (!info) return
      
      // 检查是否有AI约束要求该医生每天都工作
      const constraint = aiConstraints.doctorConstraints[info.name]
      const mustWorkEveryDay = constraint && constraint.departments && constraint.departments.length > 0
      
      // 计算工作天数（包括白班和夜班）
      const workDays = dates.filter(date => 
        info.shifts[date] && info.shifts[date] !== 'off'
      ).length
      
      // 休息天数 = 总天数 - 工作天数
      const restDays = dates.length - workDays
      
      console.log(`${info.name}: 工作天数=${workDays}, 休息天数=${restDays}, shifts=${JSON.stringify(info.shifts)}`)

      // 如果AI约束要求每天都工作，则跳过休息验证
      if (!mustWorkEveryDay && restDays < 1) {
        failedDoctors.push(info.name)
      }
    })

    return failedDoctors
  }

  /**
   * 计算休息天数
   * 🔴 CRITICAL: 统计总休息天数（包括值班后的休息日和普通的休息日）
   */
  private calculateRestDays(
    doctorSchedule: Record<string, DoctorSchedule>,
    dates: string[]
  ): void {
    Object.values(doctorSchedule).forEach(info => {
      // 🔴 CRITICAL: 统计所有休息日的天数（shifts[date] === 'off' 或者 shifts[date] 不存在）
      let restDays = 0

      dates.forEach(date => {
        // 如果 shifts[date] 不存在或者为 'off'，都算作休息
        if (!info.shifts[date] || info.shifts[date] === 'off') {
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
