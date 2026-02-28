#!/bin/bash

# 测试脚本：检查值班医生的休息天数是否正确

echo "=== 测试1: 5名医生，7天排班 ==="
for i in {1..10}; do
  echo "--- 第 $i 次测试 ---"
  curl -s -X POST http://localhost:3000/api/schedule/generate \
    -H "Content-Type: application/json" \
    -d '{
      "doctors": [
        {"name": "李茜", "isMainDuty": true},
        {"name": "姜维", "isMainDuty": true},
        {"name": "陈晓林", "isMainDuty": false},
        {"name": "高玲", "isMainDuty": false},
        {"name": "曹钰", "isMainDuty": false}
      ],
      "startDate": "2025-01-01",
      "leaveRequests": []
    }' | python3 -c "
import sys, json
data = json.load(sys.stdin)
duty_schedule = data['data']['dutySchedule']
doctor_schedule = data['data']['doctorSchedule']
dates = data['data']['dates']

# 找出所有值班医生的休息天数
duty_dates = sorted(duty_schedule.keys())
for idx, date in enumerate(duty_dates):
    doctor = duty_schedule[date]
    info = doctor_schedule[doctor]

    # 计算实际休息天数（shifts中off的天数）
    actual_rest = sum(1 for d, shift in info['shifts'].items() if shift == 'off')

    # 计算值班后应该休息的天数
    rest_days_after_duty = 0
    duty_date_index = dates.index(date)
    for j in range(duty_date_index + 1, min(duty_date_index + 3, len(dates))):
        if info['shifts'][dates[j]] == 'off':
            rest_days_after_duty += 1

    # 判断是否是倒数第二个值班医生
    is_second_last = (idx == len(duty_dates) - 2)

    # 如果休息天数少于2天，或者倒数第二个医生休息天数不准确，打印问题
    if actual_rest < 2 or (is_second_last and rest_days_after_duty != actual_rest):
        print(f'  {doctor} 在 {date} 值班')
        print(f'    实际休息天数: {actual_rest}')
        print(f'    值班后休息天数: {rest_days_after_duty}')
        print(f'    是否是倒数第二个: {is_second_last}')
        if is_second_last and rest_days_after_duty != actual_rest:
            print(f'    ⚠️ 问题: 倒数第二个值班医生的值班后休息天数({rest_days_after_duty}) != 实际休息天数({actual_rest})')
        if actual_rest < 2:
            print(f'    ⚠️ 问题: 休息天数少于2天')
"
  echo ""
done

echo "=== 测试2: 8名医生，7天排班 ==="
for i in {1..10}; do
  echo "--- 第 $i 次测试 ---"
  curl -s -X POST http://localhost:3000/api/schedule/generate \
    -H "Content-Type: application/json" \
    -d '{
      "doctors": [
        {"name": "李茜", "isMainDuty": true},
        {"name": "姜维", "isMainDuty": true},
        {"name": "陈晓林", "isMainDuty": false},
        {"name": "高玲", "isMainDuty": false},
        {"name": "曹钰", "isMainDuty": false},
        {"name": "朱朝霞", "isMainDuty": true},
        {"name": "范冬黎", "isMainDuty": true},
        {"name": "杨波", "isMainDuty": false}
      ],
      "startDate": "2025-01-01",
      "leaveRequests": []
    }' | python3 -c "
import sys, json
data = json.load(sys.stdin)
duty_schedule = data['data']['dutySchedule']
doctor_schedule = data['data']['doctorSchedule']
dates = data['data']['dates']

# 找出所有值班医生的休息天数
duty_dates = sorted(duty_schedule.keys())
for idx, date in enumerate(duty_dates):
    doctor = duty_schedule[date]
    info = doctor_schedule[doctor]

    # 计算实际休息天数（shifts中off的天数）
    actual_rest = sum(1 for d, shift in info['shifts'].items() if shift == 'off')

    # 计算值班后应该休息的天数
    rest_days_after_duty = 0
    duty_date_index = dates.index(date)
    for j in range(duty_date_index + 1, min(duty_date_index + 3, len(dates))):
        if info['shifts'][dates[j]] == 'off':
            rest_days_after_duty += 1

    # 判断是否是倒数第二个值班医生
    is_second_last = (idx == len(duty_dates) - 2)

    # 如果休息天数少于2天，或者倒数第二个医生休息天数不准确，打印问题
    if actual_rest < 2 or (is_second_last and rest_days_after_duty != actual_rest):
        print(f'  {doctor} 在 {date} 值班')
        print(f'    实际休息天数: {actual_rest}')
        print(f'    值班后休息天数: {rest_days_after_duty}')
        print(f'    是否是倒数第二个: {is_second_last}')
        if is_second_last and rest_days_after_duty != actual_rest:
            print(f'    ⚠️ 问题: 倒数第二个值班医生的值班后休息天数({rest_days_after_duty}) != 实际休息天数({actual_rest})')
        if actual_rest < 2:
            print(f'    ⚠️ 问题: 休息天数少于2天')
"
  echo ""
done
