# DeepSeek Flash 调用约束核查（2026-11-09）

本轮继续使用用户批准的 `deepseek-flash`、thinking enabled、high；未更换模型、降低档位或修改 30/90 秒验收标准。

- 官方文档提供 low/high/max 三档，high 是有效档位；thinking 模式下 temperature 不生效，因此当前发送 temperature=0 不能证明确定性，稳定性仍须靠五次实际观测。[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- Chat Completions 的 response_format 列明 text/json_object，JSON 模式不能替代业务 schema、引用或事实核验。thinking 模式也不支持强制指定工具选择，不能假设改成强制工具调用就能保证当前输出合同。[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)
- Anthropic 兼容接口明确忽略 budget_tokens，不能据此设计已验证的独立思考 token 限制。[Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)

本轮工程行动仍是精简重复材料、限定每条断言的引用范围、提供明确 schema 与修复错误，再以登记的实际调用验证。文档能力不作为速度或质量通过证据。原始隐藏推理内容不采集、不输出。
