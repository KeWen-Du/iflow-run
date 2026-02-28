from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import time
import os

# 设置选项
chrome_options = Options()
chrome_options.add_argument('--headless')  # 无头模式
chrome_options.add_argument('--no-sandbox')
chrome_options.add_argument('--disable-dev-shm-usage')
chrome_options.add_argument('--window-size=1920,1080')

# 初始化驱动
service = Service(ChromeDriverManager().install())
driver = webdriver.Chrome(service=service, options=chrome_options)

try:
    # 1. 打开首页 - 截取项目列表页面
    print("正在加载首页...")
    driver.get("http://localhost:3000")
    time.sleep(3)  # 等待页面加载

    # 截图项目列表
    driver.save_screenshot("F:\\dev-code\\iflow-project\\iflow-run\\01-projects-list.png")
    print("✅ 项目列表截图已保存: 01-projects-list.png")

    # 2. 点击第一个项目 - 进入会话列表
    print("正在点击项目...")
    try:
        project_items = driver.find_elements(By.CLASS_NAME, "project-item")
        if project_items:
            project_items[0].click()
            time.sleep(2)

            # 截图会话列表
            driver.save_screenshot("F:\\dev-code\\iflow-project\\iflow-run\\02-sessions-list.png")
            print("✅ 会话列表截图已保存: 02-sessions-list.png")

            # 3. 点击第一个会话 - 进入会话详情
            print("正在点击会话...")
            try:
                session_cards = driver.find_elements(By.CLASS_NAME, "session-card")
                if session_cards:
                    session_cards[0].click()
                    time.sleep(2)

                    # 截图会话详情
                    driver.save_screenshot("F:\\dev-code\\iflow-project\\iflow-run\\03-session-detail.png")
                    print("✅ 会话详情截图已保存: 03-session-detail.png")

                    # 4. 测试返回按钮
                    print("正在测试返回按钮...")
                    back_btn = driver.find_element(By.ID, "backBtn")
                    back_btn.click()
                    time.sleep(2)
                    print("✅ 返回按钮测试成功")

            except Exception as e:
                print(f"点击会话失败: {e}")
        else:
            print("没有找到项目")
    except Exception as e:
        print(f"点击项目失败: {e}")

except Exception as e:
    print(f"测试出错: {e}")

finally:
    driver.quit()
    print("测试完成")