对主持人五点，分别回答：

1. **部分确认**：c03 可作为“首个实验协议”，不能当作解决方案。需补 Android BLE HOGP 可行性门槛、独立日志和失败分类；ClickNova 的 iOS 版本、README 缺描述符字节，不能作为 Android→iOS 证据。
2. **一页协议**：安装 BLE_HID_EXAMPLE v2.7.0，选 Basic/Consumer，发 Volume Increment 0xE9 的 press/release；先 Home 十次，只应改音量、不应新增照片；再开 штатная Camera 前台十次；录屏、GATT 日志、Report Map、bonding/encryption、PHAsset 列表；成功=10 命令产生 10 张新原图；失败分类为未发现/未绑定/未订阅/只改音量/已拍。
3. **未找到**可核实的 Apple Accessory Design Guidelines R18 关于第三方 iOS 应用禁止发布 BLE HID 的直引和节号；不编造。Clak 同样未证实。
4. **不确认** AirDrop↔Quick Share 在 2026 年具体 Android 型号和月份；无可核实 Apple/Google 来源。
5. 首测后仍未知：Android BLE HOGP 外设是否被 iOS 26 接受、0xE9 是否触发 Camera 而非音量、重连/缓存影响、文件返回；首测只缩小因果链。

独立评估：文件方向合理，但证据分层不足。iOS 无公开“按 штатная Camera 快门”API，外部 HID 是少数合规边界。

1. 把“物理音量键拍照”等同于任意 HID Consumer，未证实；Apple 只文档物理键。修正：先 Home 测系统效果，再 Camera；廉价检查用 GATT 日志和录屏。
2. Android BLE HOGP 外设角色无公开文档保证；BluetoothGattServer API 18 ≠ HOGP 设备合规。修正：加 Classic BluetoothHidDevice API 28 对照。
3. ClickNova 是 ESP32 作者报告，不是 Android→iOS 独立复现；不能写“подтверждено”跨平台。
4. PhotoKit 取原件有文档，但 Camera 前台时后台执行无保证，Limited Photos 可隐藏新资产；修正：手动打开助手验收。
5. Clak、AirDrop、ww24 细节应标“未知/待核”，不能作为架构依据。

Вердикт: согласен с правками  
[[AO-e83vju]]