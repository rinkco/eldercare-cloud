# eldercare-cloud 项目约定

## Git 与发布

- 用户要求提交到 GitHub 时：先运行与改动范围匹配的测试，提交并推送当前分支，
  然后把该分支合并到 main（优先 ff-only）并推送到 origin/main，最后切回原分支继续工作。
- 不使用 force push；不删除分支，除非用户明确要求。
- 提交前确认未包含 .env、密钥、运行时目录、构建产物与临时文件。
