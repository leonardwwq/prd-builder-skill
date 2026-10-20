# spec.yaml 规范

`spec.yaml` 是**机器可读层**，目的：让 AI 不靠猜就能照着实现。所以它要：

- **少形容词，多枚举**。`状态: 正常` 是废话，`enum: [待处理, 处理中, 已完成]` 才是规格。
- **能和代码一一对上**。字段 key、接口路径、错误码、任务编号，都要能直接落到代码里。
- **和 PRD.md 共用编号**。本页编号在这里定义（`id:`），格式 `<类型>-<页号>-<序号>`，页号与所在目录 `NN` 一致。

每个页面目录一份。只写已知、已确认的内容；不知道的进 `open_questions`，不编。

## 顶层结构

```yaml
meta:            # 必填：这是哪个版本的哪一页
scope:           # 必填：范围边界
roles:           # 按需：角色与权限
entities:        # 按需：本页定义的数据实体与字段
flows:           # 按需：本页定义的状态机
refs:            # 按需：本页引用的其他页面定义
rules:           # 必填：业务规则 R
apis:            # 按需：接口契约（已知时才写，不编）
notifications:   # 按需：通知 / 消息
nonfunctional:   # 按需：性能、量级、安全、审计
acceptance:      # 必填：验收标准 G
tasks:           # 按需：实现任务 T（带依赖顺序）
decisions:       # 按需：已拍板的决策 D
open_questions:  # 必填：还没定的问题 Q（可以为 []，但不许省略）
```

## 各段写法

### meta
```yaml
meta:
  feature: <页面名 / 流程包名>      # 与 PRD.md 标题一致
  product: <产品名>
  version: <版本号>                 # 必须与所在版本目录名一致
  page: <NN-页面名>                 # 必须与所在页面目录名一致
  date: YYYY-MM-DD
  prd: PRD.md
  status: 草稿                      # 草稿 / 待评审 / 已确认 / 已交付
```

### scope
```yaml
scope:
  in: [<包含项>]
  out: [<明确不做的项>]
```

### entities
字段要能直接建表 / 建表单。类型用 `string|text|int|decimal|enum|date|datetime|bool|ref|list`；
`decimal` 必须给 `precision`（金额再给 `currency`），`datetime` 必须给 `tz`。
**只写本页主管的实体**；别页主管的实体写在 `refs`。

```yaml
entities:
  - name: <实体名>
    key: <实体 key>
    fields:
      - { key: <key>, label: <字段名>, type: string, required: true, max: 100 }
      - { key: <key>, label: <字段名>, type: enum, required: true, enum: [<值1>, <值2>], default: <值1>, rule: R-NN-001 }
      - { key: <key>, label: <字段名>, type: datetime, required: true, tz: <时区>, generated: true }
```

### flows（本页定义的状态机）
```yaml
flows:
  - entity: <实体名>
    states: [<状态1>, <状态2>, <状态3>]
    initial: <状态1>
    transitions:
      - { from: <状态1>, action: <动作>, actor: <角色>, to: <状态2>, guard: <前置条件或 R 编号> }
    reverse:
      - { action: <撤回/驳回/作废>, actor: <角色>, allowed_from: [<状态>], note: <下游怎么处理> }
```

### refs（引用其他页面的定义）
共用的实体 / 状态机 / 规则由主管页面定义，其他页面在这里登记来源，不抄内容。
`validate.mjs` 会检查：页面目录存在、`entity` 出现在对方 `flows` 或 `entities` 里、`ids` 在对方 spec 里有定义。

```yaml
refs:
  - { page: <NN-页面名>, entity: <实体名>, ids: [R-NN-002], uses: <本页触发哪些流转 / 遵守哪些规则> }
```

### rules / acceptance / tasks / decisions / open_questions

```yaml
rules:
  - { id: R-NN-001, text: <一条可测的规则> }

acceptance:
  - { id: G-NN-001, given: <前置数据>, when: <操作>, then: <期望结果> }

tasks:
  - { id: T-NN-001, title: <实现任务>, depends_on: [], done_when: <完成判据> }
  - { id: T-NN-002, title: <实现任务>, depends_on: [T-NN-001], done_when: <完成判据> }

decisions:
  - { id: D-NN-01, point: <决策点>, conclusion: <结论>, impact: <影响面>, status: 已定 }   # 已定 / 由我代定

open_questions:
  - { id: Q-NN-01, question: <问题>, owner: <需谁回答>, blocks: <T 编号或 —>, due: <YYYY-MM-DD 或 —> }
```

- 一页里有多个区块时，可给 rules / acceptance / tasks 加 `module: <区块名>` 方便筛选，非必填。
- `tasks.depends_on` 可以依赖别页任务（如 `T-01-002`），脚本会去对应页面核对。

## 硬性检查（validate.mjs 会验证）

1. 必填段齐全：meta / scope / rules / acceptance / open_questions；rules、acceptance 不为空。
2. 没有遗留模板占位符（`<...>`）。
3. `meta.version` 与版本目录名一致；`meta.page` 与页面目录名一致。
4. 本页定义的编号前缀等于本页页号，且不重复；不使用不带页号的旧格式。PRD/spec 可引用版本 index「版本级决策」里存在的 `D-00-xx`，不得引用 `Q-00` 或其他 `00` 号。
5. 本页 R/G 编号在 PRD.md 与 spec.yaml 两边都存在；PRD 里出现的本页 T/D/Q 必须在 spec 里有定义。
6. 引用别页的编号、`refs` 指向的页面与实体都真实存在。
7. `tasks.depends_on` 引用的任务存在，且本页内不成环。
8. mock 锚点指向的文件存在、无外链资源；`review.html` 不过期。
9. 版本级：页号不重复、`index.md` 存在并列出所有页面目录、`D-00` 不重复定义；版本与页面的 `WORKLOG.md` 都未进 Git。
10. 术语：版本 `index.md` 与工作区 `readme.md` 术语表里的禁用别名，不出现在页面 PRD.md / spec.yaml / mocks 中（带 `alias-ok` 的行除外）。
