/**
 * 推荐菜谱库
 *
 * 纯静态常量，不进 storage、不参与云同步。理由：这份库跟着版本走，用户不需要也不能改它；
 * 落进本地要占 1MB 配额，还得处理「新版加了菜、老用户本地没有」的迁移。
 * 用户点「收藏」时才复制一条进 dishes，从此变成他自己的菜。
 *
 * 人群标签 crowd 用独立字段，**不要混进 tags**：utils/report.js 的口味偏好统计是按 tags 算的，
 * 混进去会把「孕妇」统计成一种口味。
 *
 * 字段与 dishes 对齐，默认值在 normalize 里补：
 *   mealTypes 默认 ['午餐', '晚餐']，eatTypes 默认 ['自己做']
 * 只有早餐、夜宵、外卖、堂食这些「例外」才在原始数据里显式写出来，省得两百条全是重复字段。
 */

/**
 * 八类人群。
 * group 决定界面上分两排：age 年龄段（第一排，前面还会插一个「全部」）、need 特殊需求（第二排）。
 * 数组顺序就是排列顺序。加新人群时记得带 group，否则不会出现在筛选按钮里。
 */
const CROWDS = [
  { key: 'toddler', label: '幼儿', group: 'age', note: '1-3 岁 · 无盐无糖、软烂易咽' },
  { key: 'child', label: '儿童', group: 'age', note: '3-12 岁 · 少刺易嚼、口味温和' },
  { key: 'teen', label: '青少年', group: 'age', note: '12-18 岁 · 高蛋白、补钙、量要足' },
  { key: 'middle', label: '中年', group: 'age', note: '40 岁以上 · 控油控糖、护血管' },
  { key: 'elder', label: '老年人', group: 'age', note: '65 岁以上 · 软烂低盐、易消化' },
  { key: 'pregnant', label: '孕妇', group: 'need', note: '补铁叶酸、优质蛋白、少油' },
  { key: 'fitness', label: '健身减脂', group: 'need', note: '低卡高蛋白、少油少糖' },
  { key: 'chronic', label: '三高调理', group: 'need', note: '低盐低糖低脂、高纤维' }
]

/**
 * 原始条目。只写「跟默认值不一样」的部分：
 * - price 必填（四档：经济 / 普通 / 丰盛 / 豪华）
 * - crowd 必填，1~3 个
 * - why 是列表里直接显示的一句，控制在 20 字内，写「为什么适合这个人」而不是营养学课本
 */
const RAW = [
  // ---------- 汤羹粥 ----------
  { id: 'r001', name: '菠菜猪肝汤', emoji: '🥬', category: '中餐', tags: ['清淡', '高蛋白'], price: '经济', crowd: ['pregnant', 'middle'], why: '补铁，孕期最缺这一口' },
  { id: 'r002', name: '鲫鱼豆腐汤', emoji: '🐟', category: '中餐', tags: ['清淡', '高蛋白'], price: '普通', crowd: ['pregnant', 'elder', 'middle'], why: '优质蛋白加钙，好消化' },
  { id: 'r003', name: '山药排骨汤', emoji: '🍲', category: '中餐', tags: ['清淡'], price: '普通', crowd: ['elder', 'middle'], why: '软烂易嚼，健脾养胃' },
  { id: 'r004', name: '番茄牛腩', emoji: '🍅', category: '中餐', tags: ['高蛋白'], price: '丰盛', crowd: ['teen'], why: '长身体，蛋白质要够' },
  { id: 'r005', name: '虾仁蒸蛋', emoji: '🍤', category: '中餐', tags: ['清淡', '高蛋白'], price: '经济', crowd: ['pregnant', 'child', 'middle'], mealTypes: ['早餐', '午餐'], why: '好吸收，早餐也吃不腻' },
  { id: 'r006', name: '清蒸鲈鱼', emoji: '🐟', category: '中餐', tags: ['清淡'], price: '普通', crowd: ['elder', 'chronic', 'middle'], why: '少油少刺，牙口不好也能吃' },
  { id: 'r007', name: '小米南瓜粥', emoji: '🎃', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['elder', 'child', 'middle'], mealTypes: ['早餐'], why: '养胃，早上来一碗' },
  { id: 'r008', name: '红枣乌鸡汤', emoji: '🍗', category: '中餐', tags: ['清淡', '高蛋白'], price: '丰盛', crowd: ['pregnant', 'middle'], why: '补气血，产后也合适' },
  { id: 'r009', name: '玉米排骨汤', emoji: '🌽', category: '中餐', tags: ['清淡'], price: '普通', crowd: ['elder', 'child', 'middle'], why: '清甜，孩子也爱喝' },
  { id: 'r010', name: '冬瓜丸子汤', emoji: '🥣', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['elder', 'chronic', 'middle'], why: '低脂利水，不腻' },
  { id: 'r011', name: '紫菜蛋花汤', emoji: '🥚', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['fitness', 'elder', 'middle'], why: '五分钟出锅，低卡' },
  { id: 'r012', name: '番茄鸡蛋汤', emoji: '🍅', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['child', 'elder', 'middle'], why: '开胃，酸甜好下饭' },
  { id: 'r013', name: '银耳莲子羹', emoji: '🥣', category: '中餐', tags: ['清淡'], price: '普通', crowd: ['pregnant', 'elder', 'middle'], why: '润燥，糖别放多' },
  { id: 'r014', name: '黑鱼汤', emoji: '🐟', category: '中餐', tags: ['高蛋白', '清淡'], price: '丰盛', crowd: ['pregnant', 'middle'], why: '伤口恢复期常喝' },
  { id: 'r015', name: '花生猪蹄汤', emoji: '🥜', category: '中餐', tags: ['高蛋白'], price: '丰盛', crowd: ['pregnant'], why: '胶原足，但别喝太油' },
  { id: 'r016', name: '萝卜牛腩煲', emoji: '🥕', category: '中餐', tags: ['高蛋白'], price: '丰盛', crowd: ['teen', 'elder'], why: '炖透了萝卜比肉香' },
  { id: 'r017', name: '菌菇鸡汤', emoji: '🍄', category: '中餐', tags: ['清淡', '高蛋白'], price: '普通', crowd: ['elder', 'middle'], why: '鲜味足，不用多放盐' },
  { id: 'r018', name: '海带排骨汤', emoji: '🌊', category: '中餐', tags: ['清淡'], price: '普通', crowd: ['pregnant', 'chronic', 'middle'], why: '补碘，甲状腺有问题先问医生' },
  { id: 'r019', name: '莲藕排骨汤', emoji: '🪷', category: '中餐', tags: ['清淡'], price: '普通', crowd: ['elder', 'middle'], why: '粉糯，好嚼' },
  { id: 'r020', name: '鲫鱼萝卜丝汤', emoji: '🐟', category: '中餐', tags: ['清淡', '高蛋白'], price: '普通', crowd: ['pregnant', 'elder', 'middle'], why: '汤色奶白，就一个字鲜' },
  { id: 'r021', name: '蒸水蛋', emoji: '🥚', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['child', 'elder', 'middle'], why: '嫩，一岁多就能吃' },
  { id: 'r022', name: '燕麦粥', emoji: '🥣', category: '西餐', tags: ['清淡', '减脂'], price: '经济', crowd: ['fitness', 'chronic', 'middle'], mealTypes: ['早餐'], why: '顶饱，血糖升得慢' },
  { id: 'r023', name: '杂粮饭', emoji: '🍚', category: '米饭', tags: ['清淡', '减脂'], price: '经济', crowd: ['chronic', 'fitness', 'middle'], why: '换成三色米，纤维翻倍' },
  { id: 'r024', name: '藜麦沙拉', emoji: '🥗', category: '西餐', tags: ['减脂', '清淡'], price: '丰盛', crowd: ['fitness', 'middle'], why: '蛋白质和纤维都够' },
  { id: 'r025', name: '鸡胸肉沙拉', emoji: '🥗', category: '西餐', tags: ['减脂', '高蛋白'], price: '普通', crowd: ['fitness'], why: '油醋汁，别用沙拉酱' },
  { id: 'r026', name: '水煮西兰花', emoji: '🥦', category: '中餐', tags: ['减脂', '清淡', '简单'], price: '经济', crowd: ['fitness', 'chronic', 'middle'], why: '断生就捞，别煮黄' },
  { id: 'r027', name: '白灼虾', emoji: '🦐', category: '中餐', tags: ['清淡', '高蛋白'], price: '丰盛', crowd: ['fitness', 'pregnant', 'middle'], why: '蘸料少放，鲜味够' },
  { id: 'r028', name: '清蒸鸡胸', emoji: '🍗', category: '中餐', tags: ['高蛋白', '减脂'], price: '普通', crowd: ['fitness'], why: '蒸比煎省油' },
  { id: 'r029', name: '凉拌黄瓜', emoji: '🥒', category: '中餐', tags: ['清淡', '简单', '减脂'], price: '经济', crowd: ['chronic', 'fitness', 'middle'], why: '少盐，蒜末提味' },
  { id: 'r030', name: '凉拌木耳', emoji: '🍄', category: '中餐', tags: ['清淡', '减脂'], price: '经济', crowd: ['chronic', 'middle'], why: '木耳泡发别超四小时' },
  { id: 'r031', name: '蒜蓉菠菜', emoji: '🥬', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['pregnant', 'middle'], why: '叶酸和铁都在绿叶里' },
  { id: 'r032', name: '上汤娃娃菜', emoji: '🥬', category: '中餐', tags: ['清淡'], price: '普通', crowd: ['elder', 'pregnant', 'middle'], why: '汤鲜菜嫩' },
  { id: 'r033', name: '蒜蓉西兰花', emoji: '🥦', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['chronic', 'middle'], why: '快炒才保得住脆劲' },
  { id: 'r034', name: '香菇油菜', emoji: '🍄', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['chronic', 'elder', 'middle'], why: '少油，勾一层薄芡' },
  { id: 'r035', name: '清炒芦笋', emoji: '🎋', category: '中餐', tags: ['清淡', '减脂'], price: '丰盛', crowd: ['fitness', 'pregnant', 'middle'], why: '叶酸高，别炒老' },
  { id: 'r036', name: '蒜泥茄子', emoji: '🍆', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['chronic', 'elder', 'middle'], why: '蒸的，比过油省一半热量' },
  { id: 'r037', name: '白灼菜心', emoji: '🥬', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['chronic', 'elder', 'middle'], why: '广式做法，蚝油少放' },
  { id: 'r038', name: '蚝油生菜', emoji: '🥬', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['chronic', 'elder', 'middle'], why: '三十秒出锅' },
  { id: 'r039', name: '醋溜白菜', emoji: '🥬', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['elder', 'chronic', 'middle'], why: '酸口开胃' },
  { id: 'r040', name: '麻酱菠菜', emoji: '🥬', category: '中餐', tags: ['清淡', '高蛋白'], price: '经济', crowd: ['pregnant', 'chronic', 'middle'], why: '芝麻酱补钙' },
  { id: 'r041', name: '番茄豆腐', emoji: '🍅', category: '中餐', tags: ['清淡', '高蛋白'], price: '经济', crowd: ['pregnant', 'elder', 'middle'], why: '植物蛋白加维 C' },
  { id: 'r042', name: '西葫芦炒蛋', emoji: '🥒', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['child', 'elder', 'middle'], why: '出水多，别另外加水' },
  { id: 'r043', name: '洋葱炒蛋', emoji: '🧅', category: '中餐', tags: ['简单'], price: '经济', crowd: ['child', 'elder'], why: '洋葱炒软了是甜的' },
  { id: 'r044', name: '番茄炒蛋', emoji: '🍅', category: '中餐', tags: ['简单'], price: '经济', crowd: ['child'], why: '家家都有的那一道' },
  { id: 'r045', name: '青椒土豆丝', emoji: '🥔', category: '中餐', tags: ['简单'], price: '经济', crowd: ['child'], why: '脆一点更好吃' },
  { id: 'r046', name: '香菇滑鸡', emoji: '🍄', category: '中餐', tags: ['高蛋白', '清淡'], price: '普通', crowd: ['elder', 'middle'], why: '蒸出来的，不上火' },
  { id: 'r047', name: '梅菜扣肉', emoji: '🥓', category: '中餐', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '油大，配饭刚好' },
  { id: 'r048', name: '粉蒸肉', emoji: '🍖', category: '中餐', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '米粉裹着，软糯' },
  { id: 'r049', name: '珍珠丸子', emoji: '⚪', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['child', 'teen'], why: '糯米裹肉，孩子抢着吃' },
  { id: 'r050', name: '狮子头', emoji: '🦁', category: '中餐', tags: ['高蛋白'], price: '丰盛', crowd: ['elder', 'teen'], why: '炖透了入口即化' },

  // ---------- 主食：米饭与面 ----------
  { id: 'r051', name: '蛋炒饭', emoji: '🍚', category: '米饭', tags: ['简单'], price: '经济', crowd: ['teen', 'child'], why: '隔夜饭最合适' },
  { id: 'r052', name: '扬州炒饭', emoji: '🍚', category: '米饭', tags: ['高蛋白'], price: '普通', crowd: ['teen', 'child'], why: '虾仁火腿都放一点' },
  { id: 'r053', name: '咖喱鸡饭', emoji: '🍛', category: '米饭', tags: ['聚餐'], price: '普通', crowd: ['teen'], why: '咖喱块最省事' },
  { id: 'r054', name: '黄焖鸡米饭', emoji: '🍛', category: '米饭', tags: ['聚餐'], price: '普通', crowd: ['teen'], why: '汤汁拌饭是一绝' },
  { id: 'r055', name: '卤肉饭', emoji: '🍚', category: '米饭', tags: ['聚餐'], price: '普通', crowd: ['teen'], why: '卤汁浇饭，一勺就够' },
  { id: 'r056', name: '腊味煲仔饭', emoji: '🍚', category: '米饭', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '锅巴才是精华' },
  { id: 'r057', name: '牛肉面', emoji: '🍜', category: '面食', tags: ['高蛋白'], price: '普通', crowd: ['teen'], why: '清汤红烧都行' },
  { id: 'r058', name: '阳春面', emoji: '🍜', category: '面食', tags: ['清淡', '简单'], price: '经济', crowd: ['elder', 'middle'], why: '胃不舒服时最合适' },
  { id: 'r059', name: '葱油拌面', emoji: '🍜', category: '面食', tags: ['简单'], price: '经济', crowd: ['teen'], why: '五分钟，香得很' },
  { id: 'r060', name: '炸酱面', emoji: '🍜', category: '面食', tags: [], price: '普通', crowd: ['teen'], why: '酱要炒透才不腥' },
  { id: 'r061', name: '打卤面', emoji: '🍜', category: '面食', tags: [], price: '经济', crowd: ['teen', 'elder'], why: '卤子稠一点才挂得住' },
  { id: 'r062', name: '云吞面', emoji: '🍜', category: '面食', tags: ['清淡'], price: '普通', crowd: ['elder', 'child', 'middle'], why: '皮薄馅嫩，汤清' },
  { id: 'r063', name: '酸辣粉', emoji: '🌶️', category: '面食', tags: ['辣'], price: '经济', crowd: ['teen'], why: '醋和辣自己调' },
  { id: 'r064', name: '螺蛳粉', emoji: '🍜', category: '面食', tags: ['辣'], price: '普通', crowd: ['teen'], why: '家里煮要开窗' },
  { id: 'r065', name: '热干面', emoji: '🍜', category: '面食', tags: ['简单'], price: '经济', crowd: ['teen'], why: '芝麻酱要澥开' },
  { id: 'r066', name: '牛肉粉', emoji: '🍜', category: '面食', tags: ['高蛋白'], price: '普通', crowd: ['teen'], why: '汤头要熬够' },
  { id: 'r067', name: '桂林米粉', emoji: '🍜', category: '面食', tags: ['简单'], price: '经济', crowd: ['teen'], why: '卤水是灵魂' },
  { id: 'r068', name: '过桥米线', emoji: '🍲', category: '面食', tags: ['高蛋白'], price: '丰盛', crowd: ['teen'], why: '汤必须滚烫' },
  { id: 'r069', name: '饺子', emoji: '🥟', category: '面食', tags: ['高蛋白'], price: '普通', crowd: ['teen', 'child'], why: '一家人包一下午' },
  { id: 'r070', name: '小笼包', emoji: '🥟', category: '面食', tags: [], price: '普通', crowd: ['teen'], why: '先咬开吸汤' },
  { id: 'r071', name: '生煎包', emoji: '🥟', category: '面食', tags: [], price: '普通', crowd: ['teen'], why: '底要煎脆' },
  { id: 'r072', name: '包子', emoji: '🥟', category: '面食', tags: ['简单'], price: '经济', crowd: ['teen', 'child'], mealTypes: ['早餐'], why: '肉馅素馅都行' },
  { id: 'r073', name: '馄饨', emoji: '🥟', category: '面食', tags: ['清淡'], price: '经济', crowd: ['elder', 'child', 'middle'], why: '汤里放紫菜虾皮' },
  { id: 'r074', name: '韭菜盒子', emoji: '🥟', category: '面食', tags: ['简单'], price: '经济', crowd: ['teen'], why: '现烙的才香' },
  { id: 'r075', name: '烧麦', emoji: '🥟', category: '面食', tags: [], price: '经济', crowd: ['teen'], why: '糯米馅，顶饱' },
  { id: 'r076', name: '肠粉', emoji: '🍥', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['elder', 'middle'], mealTypes: ['早餐'], why: '广式早餐，酱油少淋' },
  { id: 'r077', name: '虾饺', emoji: '🥟', category: '中餐', tags: ['清淡', '高蛋白'], price: '丰盛', crowd: ['middle'], why: '一口一个' },
  { id: 'r078', name: '叉烧包', emoji: '🥟', category: '中餐', tags: ['简单'], price: '普通', crowd: ['child'], mealTypes: ['早餐'], why: '甜口，孩子喜欢' },
  { id: 'r079', name: '鸡蛋饼', emoji: '🥞', category: '中餐', tags: ['简单'], price: '经济', crowd: ['child'], mealTypes: ['早餐'], why: '摊薄一点更香' },
  { id: 'r080', name: '煎饼果子', emoji: '🌯', category: '快餐', tags: ['简单'], price: '经济', crowd: ['teen'], mealTypes: ['早餐'], why: '加蛋加薄脆' },

  // ---------- 早餐与粥 ----------
  { id: 'r081', name: '豆浆油条', emoji: '🥛', category: '中餐', tags: ['简单'], price: '经济', crowd: ['middle'], mealTypes: ['早餐'], why: '经典搭配，油条偶尔吃' },
  { id: 'r082', name: '小米粥', emoji: '🥣', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['elder', 'child', 'middle'], mealTypes: ['早餐'], why: '胃不舒服就喝它' },
  { id: 'r083', name: '皮蛋瘦肉粥', emoji: '🥣', category: '中餐', tags: ['清淡'], price: '普通', crowd: ['elder', 'child', 'middle'], mealTypes: ['早餐'], why: '米要煮到开花' },
  { id: 'r084', name: '南瓜粥', emoji: '🎃', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['child', 'elder', 'middle'], mealTypes: ['早餐'], why: '自带甜味，不用加糖' },
  { id: 'r085', name: '八宝粥', emoji: '🥣', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['elder', 'chronic', 'middle'], mealTypes: ['早餐'], why: '杂粮多，纤维够' },
  { id: 'r086', name: '红豆薏米粥', emoji: '🫘', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['fitness', 'chronic', 'middle'], mealTypes: ['早餐'], why: '当杂粮吃，别当药' },
  { id: 'r087', name: '山药粥', emoji: '🍠', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['elder', 'child', 'middle'], mealTypes: ['早餐'], why: '绵软，好消化' },
  { id: 'r088', name: '白粥配咸菜', emoji: '🥣', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['elder', 'middle'], mealTypes: ['早餐'], why: '咸菜少吃，钠高' },
  { id: 'r089', name: '砂锅粥', emoji: '🍲', category: '中餐', tags: ['清淡'], price: '丰盛', crowd: ['elder', 'child', 'middle'], why: '现煮的才鲜' },
  { id: 'r090', name: '海鲜粥', emoji: '🦐', category: '中餐', tags: ['清淡', '高蛋白'], price: '丰盛', crowd: ['pregnant', 'elder', 'middle'], why: '虾蟹一定要新鲜' },

  // ---------- 蛋与轻食 ----------
  { id: 'r091', name: '水煮蛋', emoji: '🥚', category: '中餐', tags: ['高蛋白', '简单'], price: '经济', crowd: ['fitness', 'child'], mealTypes: ['早餐'], why: '一天一个，够了' },
  { id: 'r092', name: '茶叶蛋', emoji: '🥚', category: '中餐', tags: ['简单'], price: '经济', crowd: ['middle'], mealTypes: ['早餐'], why: '卤一晚更入味' },
  { id: 'r093', name: '荷包蛋', emoji: '🍳', category: '中餐', tags: ['简单', '高蛋白'], price: '经济', crowd: ['child', 'teen'], mealTypes: ['早餐'], why: '边缘煎脆最好吃' },
  { id: 'r094', name: '燕麦牛奶', emoji: '🥣', category: '西餐', tags: ['清淡', '减脂'], price: '经济', crowd: ['fitness', 'middle'], mealTypes: ['早餐'], why: '早上两分钟搞定' },
  { id: 'r095', name: '希腊酸奶碗', emoji: '🥣', category: '西餐', tags: ['减脂', '高蛋白'], price: '普通', crowd: ['fitness'], mealTypes: ['早餐'], why: '蛋白高，糖少' },
  { id: 'r096', name: '鸡蛋三明治', emoji: '🥪', category: '西餐', tags: ['简单'], price: '经济', crowd: ['child'], mealTypes: ['早餐'], why: '早餐十分钟' },
  { id: 'r097', name: '三明治', emoji: '🥪', category: '西餐', tags: ['简单'], price: '经济', crowd: ['fitness'], mealTypes: ['早餐'], why: '全麦面包打底' },
  { id: 'r098', name: '蒸紫薯', emoji: '🍠', category: '中餐', tags: ['减脂', '简单'], price: '经济', crowd: ['fitness'], mealTypes: ['早餐'], why: '花青素就在皮下面' },
  { id: 'r099', name: '蒸南瓜', emoji: '🎃', category: '中餐', tags: ['清淡', '简单', '减脂'], price: '经济', crowd: ['elder', 'chronic', 'fitness', 'middle'], mealTypes: ['早餐'], why: '当主食换个口味' },
  { id: 'r100', name: '蒸红薯', emoji: '🍠', category: '中餐', tags: ['清淡', '简单', '减脂'], price: '经济', crowd: ['fitness', 'chronic', 'middle'], mealTypes: ['早餐'], why: '纤维足，顶饱' },

  // ---------- 禽类 ----------
  { id: 'r101', name: '白切鸡', emoji: '🍗', category: '中餐', tags: ['清淡', '高蛋白'], price: '丰盛', crowd: ['elder', 'middle'], why: '蘸姜葱，酱油少蘸' },
  { id: 'r102', name: '口水鸡', emoji: '🍗', category: '中餐', tags: ['辣'], price: '普通', crowd: ['middle'], why: '红油自己调，别太狠' },
  { id: 'r103', name: '三杯鸡', emoji: '🍗', category: '中餐', tags: ['聚餐'], price: '普通', crowd: ['teen'], why: '九层塔是灵魂' },
  { id: 'r104', name: '大盘鸡', emoji: '🍗', category: '中餐', tags: ['辣', '聚餐'], price: '丰盛', crowd: ['teen'], why: '最后下一把宽面' },
  { id: 'r105', name: '可乐鸡翅', emoji: '🍗', category: '中餐', tags: ['聚餐'], price: '普通', crowd: ['child', 'teen'], why: '小孩最爱，糖不少' },
  { id: 'r106', name: '宫保鸡丁', emoji: '🍗', category: '中餐', tags: ['辣', '高蛋白'], price: '普通', crowd: ['teen'], why: '花生别放太多' },
  { id: 'r107', name: '啤酒鸭', emoji: '🦆', category: '中餐', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '酒味会烧掉，别怕' },
  { id: 'r108', name: '老鸭汤', emoji: '🦆', category: '中餐', tags: ['清淡', '高蛋白'], price: '丰盛', crowd: ['elder', 'pregnant', 'middle'], why: '炖两小时，汤清不油' },
  { id: 'r109', name: '烤鸭', emoji: '🦆', category: '中餐', tags: ['聚餐'], price: '豪华', crowd: ['teen'], why: '片皮蘸糖，趁热' },
  { id: 'r110', name: '烧鹅', emoji: '🦢', category: '中餐', tags: ['聚餐'], price: '豪华', crowd: ['teen'], why: '广式烧腊，皮要脆' },
  { id: 'r111', name: '卤鸡腿', emoji: '🍗', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['teen', 'fitness'], why: '去皮更清爽' },
  { id: 'r112', name: '烤鸡腿', emoji: '🍗', category: '西餐', tags: ['高蛋白'], price: '普通', crowd: ['teen'], why: '腌一晚更入味' },
  { id: 'r113', name: '香煎鸡排', emoji: '🍗', category: '西餐', tags: ['高蛋白'], price: '普通', crowd: ['teen'], why: '拍松再煎不柴' },
  { id: 'r114', name: '烤鸡胸肉', emoji: '🍗', category: '西餐', tags: ['高蛋白', '减脂'], price: '普通', crowd: ['fitness'], why: '黑胡椒加盐就够' },
  { id: 'r115', name: '鸡胸肉卷', emoji: '🫔', category: '西餐', tags: ['高蛋白', '减脂'], price: '普通', crowd: ['fitness'], why: '生菜卷着吃，不腻' },
  { id: 'r116', name: '日式茶碗蒸', emoji: '🥚', category: '日料', tags: ['清淡', '高蛋白'], price: '普通', crowd: ['child', 'elder', 'middle'], why: '滑，勺子一挖就开' },

  // ---------- 畜肉 ----------
  { id: 'r117', name: '糖醋排骨', emoji: '🍖', category: '中餐', tags: ['聚餐'], price: '丰盛', crowd: ['child', 'teen'], why: '酸甜口，饭能多吃半碗' },
  { id: 'r118', name: '糖醋里脊', emoji: '🥩', category: '中餐', tags: ['聚餐'], price: '普通', crowd: ['child', 'teen'], why: '外脆里嫩，趁热吃' },
  { id: 'r119', name: '红烧肉', emoji: '🍖', category: '中餐', tags: ['聚餐'], price: '豪华', crowd: ['teen'], why: '偶尔一顿，别常来' },
  { id: 'r120', name: '回锅肉', emoji: '🥓', category: '中餐', tags: ['辣', '聚餐'], price: '丰盛', crowd: ['teen'], why: '肥瘦相间才香' },
  { id: 'r121', name: '鱼香肉丝', emoji: '🥕', category: '中餐', tags: ['辣'], price: '普通', crowd: ['middle'], why: '下饭神器' },
  { id: 'r122', name: '蒜苔炒肉', emoji: '🧄', category: '中餐', tags: ['简单'], price: '普通', crowd: ['middle'], why: '十分钟一道' },
  { id: 'r123', name: '青椒肉丝', emoji: '🫑', category: '中餐', tags: ['简单'], price: '普通', crowd: ['middle'], why: '肉丝先腌一下更嫩' },
  { id: 'r124', name: '豆干炒肉', emoji: '🫘', category: '中餐', tags: ['高蛋白'], price: '经济', crowd: ['teen'], why: '豆干吸味，越嚼越香' },
  { id: 'r125', name: '京酱肉丝', emoji: '🥩', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['teen'], why: '豆腐皮卷着吃' },
  { id: 'r126', name: '酱牛肉', emoji: '🥩', category: '中餐', tags: ['高蛋白'], price: '丰盛', crowd: ['teen', 'fitness'], why: '冷切，夹馒头也行' },
  { id: 'r127', name: '卤味拼盘', emoji: '🍖', category: '中餐', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '一次卤一锅，省事' },
  { id: 'r128', name: '四喜丸子', emoji: '🍡', category: '中餐', tags: ['高蛋白', '聚餐'], price: '丰盛', crowd: ['teen'], why: '宴客菜，家常也能做' },
  { id: 'r129', name: '东坡肉', emoji: '🥩', category: '中餐', tags: ['聚餐'], price: '豪华', crowd: ['teen'], why: '慢炖两小时，急不得' },
  { id: 'r130', name: '土豆炖牛肉', emoji: '🥔', category: '中餐', tags: ['高蛋白'], price: '丰盛', crowd: ['teen', 'elder'], why: '炖到筷子能戳透' },
  { id: 'r131', name: '咖喱牛肉', emoji: '🍛', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['teen'], why: '土豆胡萝卜一起下' },
  { id: 'r132', name: '黑椒牛柳', emoji: '🥩', category: '西餐', tags: ['高蛋白'], price: '丰盛', crowd: ['teen'], why: '洋葱垫底更香' },
  { id: 'r133', name: '牛肉粒', emoji: '🥩', category: '西餐', tags: ['高蛋白'], price: '丰盛', crowd: ['teen', 'fitness'], why: '大火快煎，别翻太勤' },
  { id: 'r134', name: '手打牛肉丸', emoji: '🍡', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['teen', 'child'], why: '弹牙，煮汤也行' },
  { id: 'r135', name: '猪肉脯', emoji: '🥓', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['teen'], why: '甜咸口，当零嘴' },
  { id: 'r136', name: '麻婆豆腐', emoji: '🌶️', category: '中餐', tags: ['辣', '高蛋白'], price: '经济', crowd: ['teen'], why: '豆腐比肉便宜，蛋白不少' },
  { id: 'r137', name: '干煸四季豆', emoji: '🫘', category: '中餐', tags: ['辣'], price: '普通', crowd: ['middle'], why: '一定煸熟，生的有毒' },
  { id: 'r138', name: '地三鲜', emoji: '🍆', category: '中餐', tags: [], price: '经济', crowd: ['middle'], why: '三样都过油，费油但香' },
  { id: 'r139', name: '鱼香茄子', emoji: '🍆', category: '中餐', tags: ['辣'], price: '普通', crowd: ['middle'], why: '茄子先炸才不吸油' },
  { id: 'r140', name: '干锅花菜', emoji: '🥦', category: '中餐', tags: ['辣'], price: '普通', crowd: ['middle'], why: '五花肉煸出油打底' },
  { id: 'r141', name: '虎皮青椒', emoji: '🫑', category: '中餐', tags: ['辣', '简单'], price: '经济', crowd: ['middle'], why: '煎出虎皮再调汁' },
  { id: 'r142', name: '手撕包菜', emoji: '🥬', category: '中餐', tags: ['简单', '辣'], price: '经济', crowd: ['middle'], why: '全程大火，别盖锅' },
  { id: 'r143', name: '酸辣土豆丝', emoji: '🥔', category: '中餐', tags: ['辣', '简单'], price: '经济', crowd: ['middle'], why: '泡水去淀粉才脆' },
  { id: 'r144', name: '番茄土豆汤', emoji: '🍅', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['child', 'elder', 'middle'], why: '简单，酸甜开胃' },
  { id: 'r145', name: '卤蛋', emoji: '🥚', category: '中餐', tags: ['高蛋白'], price: '经济', crowd: ['fitness', 'teen'], why: '便当常客' },
  { id: 'r146', name: '山药泥', emoji: '🍠', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['child', 'elder', 'middle'], why: '加一点奶更顺' },
  { id: 'r147', name: '蒸玉米', emoji: '🌽', category: '中餐', tags: ['清淡', '简单'], price: '经济', crowd: ['fitness', 'child', 'middle'], why: '当主食换换口' },
  { id: 'r148', name: '土豆泥', emoji: '🥔', category: '西餐', tags: ['简单'], price: '经济', crowd: ['child'], why: '黄油少放，用牛奶调' },
  { id: 'r149', name: '蔬菜沙拉', emoji: '🥗', category: '西餐', tags: ['减脂', '清淡'], price: '普通', crowd: ['fitness', 'middle'], why: '酱汁单独放，蘸着吃' },
  { id: 'r150', name: '罗宋汤', emoji: '🍲', category: '西餐', tags: [], price: '普通', crowd: ['middle'], why: '番茄牛腩加卷心菜' },

  // ---------- 水产 ----------
  { id: 'r151', name: '水煮鱼', emoji: '🌶️', category: '中餐', tags: ['辣', '高蛋白'], price: '丰盛', crowd: ['teen'], why: '油多，捞着吃别喝汤' },
  { id: 'r152', name: '酸菜鱼', emoji: '🐟', category: '中餐', tags: ['辣', '高蛋白'], price: '丰盛', crowd: ['teen'], why: '汤别喝太多，钠高' },
  { id: 'r153', name: '清蒸鲳鱼', emoji: '🐟', category: '中餐', tags: ['清淡', '高蛋白'], price: '普通', crowd: ['elder', 'child', 'middle'], why: '刺少，孩子也能吃' },
  { id: 'r154', name: '红烧带鱼', emoji: '🐟', category: '中餐', tags: [], price: '普通', crowd: ['elder'], why: '先煎定型再烧' },
  { id: 'r155', name: '香煎三文鱼', emoji: '🐟', category: '西餐', tags: ['高蛋白'], price: '豪华', crowd: ['fitness', 'pregnant'], why: '做熟吃，孕妇也能吃' },
  { id: 'r156', name: '蒜香烤虾', emoji: '🦐', category: '西餐', tags: ['高蛋白'], price: '丰盛', crowd: ['fitness', 'teen'], why: '烤箱二十分钟' },
  { id: 'r157', name: '寿司拼盘', emoji: '🍣', category: '日料', tags: ['清淡', '聚餐'], price: '丰盛', crowd: ['middle'], why: '生冷，孕妇避开' },
  { id: 'r158', name: '三文鱼刺身', emoji: '🍣', category: '日料', tags: ['高蛋白'], price: '豪华', crowd: ['fitness'], why: '孕妇和免疫力低的别吃生的' },
  { id: 'r159', name: '鳗鱼饭', emoji: '🍱', category: '日料', tags: ['高蛋白'], price: '豪华', crowd: ['teen'], why: '甜咸酱汁，很下饭' },
  { id: 'r160', name: '天妇罗', emoji: '🍤', category: '日料', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '油大，趁热吃' },
  { id: 'r161', name: '日式冷豆腐', emoji: '🥢', category: '日料', tags: ['清淡', '简单'], price: '经济', crowd: ['elder', 'chronic', 'middle'], why: '柴鱼片提鲜，酱油几滴就够' },
  { id: 'r162', name: '味噌豆腐汤', emoji: '🍲', category: '日料', tags: ['清淡', '简单'], price: '经济', crowd: ['elder', 'chronic', 'middle'], why: '豆腐嫩，味噌少放' },
  { id: 'r163', name: '韩式拌饭', emoji: '🍚', category: '韩餐', tags: ['聚餐'], price: '普通', crowd: ['teen'], why: '拌开才好吃' },
  { id: 'r164', name: '部队锅', emoji: '🍲', category: '韩餐', tags: ['辣', '聚餐'], price: '丰盛', crowd: ['teen'], why: '人多才热闹' },
  { id: 'r165', name: '韩式炸鸡', emoji: '🍗', category: '韩餐', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '配啤酒是成年人的事' },
  { id: 'r166', name: '泡菜汤', emoji: '🍲', category: '韩餐', tags: ['辣'], price: '普通', crowd: ['teen'], why: '酸辣开胃' },
  { id: 'r167', name: '辣炒年糕', emoji: '🍡', category: '韩餐', tags: ['辣'], price: '经济', crowd: ['teen'], why: '甜辣口，逛街必买' },

  // ---------- 西式 ----------
  { id: 'r168', name: '意大利面', emoji: '🍝', category: '西餐', tags: [], price: '普通', crowd: ['middle'], why: '番茄底或白酱都行' },
  { id: 'r169', name: '番茄肉酱意面', emoji: '🍝', category: '西餐', tags: ['高蛋白'], price: '普通', crowd: ['teen', 'child'], why: '孩子接受度最高' },
  { id: 'r170', name: '牛排', emoji: '🥩', category: '西餐', tags: ['高蛋白'], price: '豪华', crowd: ['teen', 'fitness'], why: '五分熟，静置两分钟再切' },
  { id: 'r171', name: '汉堡', emoji: '🍔', category: '快餐', tags: ['聚餐'], price: '普通', crowd: ['teen'], why: '偶尔一顿就行' },
  { id: 'r172', name: '薯条', emoji: '🍟', category: '快餐', tags: ['聚餐'], price: '经济', crowd: ['teen'], why: '空气炸锅做，油少一半' },
  { id: 'r173', name: '披萨', emoji: '🍕', category: '西餐', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '芝士要能拉丝' },
  { id: 'r174', name: '班尼迪克蛋', emoji: '🍳', category: '西餐', tags: ['高蛋白'], price: '丰盛', crowd: ['teen'], why: '荷兰酱是关键' },
  { id: 'r175', name: '奶油蘑菇汤', emoji: '🍄', category: '西餐', tags: [], price: '普通', crowd: ['child'], why: '面粉炒香再下奶' },
  { id: 'r176', name: '玉米浓汤', emoji: '🌽', category: '西餐', tags: ['清淡'], price: '普通', crowd: ['child', 'elder', 'middle'], why: '破壁机打细，不用过筛' },
  { id: 'r177', name: '凉皮', emoji: '🌾', category: '面食', tags: ['辣', '简单'], price: '经济', crowd: ['teen'], why: '醋蒜水自己调' },
  { id: 'r178', name: '担担面', emoji: '🍜', category: '面食', tags: ['辣'], price: '普通', crowd: ['teen'], why: '花生碎和芽菜不能少' },
  { id: 'r179', name: '重庆小面', emoji: '🍜', category: '面食', tags: ['辣'], price: '经济', crowd: ['teen'], why: '辣度提前说' },
  { id: 'r180', name: '芝麻拌面', emoji: '🍜', category: '面食', tags: ['简单'], price: '经济', crowd: ['teen'], why: '夏天过凉水更爽' },

  // ---------- 甜品 ----------
  { id: 'r181', name: '蛋挞', emoji: '🥧', category: '甜品', tags: ['聚餐'], price: '经济', crowd: ['child', 'teen'], why: '现烤的最好吃' },
  { id: 'r182', name: '蛋糕', emoji: '🍰', category: '甜品', tags: ['聚餐'], price: '普通', crowd: ['child', 'teen'], why: '生日必须有' },
  { id: 'r183', name: '提拉米苏', emoji: '🍰', category: '甜品', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '含咖啡和酒，孕妇避开' },
  { id: 'r184', name: '双皮奶', emoji: '🍮', category: '甜品', tags: ['清淡'], price: '普通', crowd: ['child', 'elder', 'middle'], why: '广式甜品，糖可以减' },
  { id: 'r185', name: '芒果班戟', emoji: '🥭', category: '甜品', tags: ['聚餐'], price: '普通', crowd: ['teen'], why: '奶油别放太多' },
  { id: 'r186', name: '杨枝甘露', emoji: '🥭', category: '甜品', tags: ['清淡'], price: '普通', crowd: ['middle'], why: '西柚粒解腻' },
  { id: 'r187', name: '龟苓膏', emoji: '🍮', category: '甜品', tags: ['清淡'], price: '经济', crowd: ['middle'], why: '苦，配一点蜂蜜' },
  { id: 'r188', name: '汤圆', emoji: '🍡', category: '甜品', tags: [], price: '经济', crowd: ['child', 'elder'], why: '糯米难消化，别多吃' },
  { id: 'r189', name: '月饼', emoji: '🥮', category: '甜品', tags: ['聚餐'], price: '丰盛', crowd: ['teen'], why: '切块分着吃，一个人吃不完' },
  { id: 'r190', name: '绿豆沙', emoji: '🫘', category: '甜品', tags: ['清淡'], price: '经济', crowd: ['elder', 'chronic', 'middle'], why: '夏天消暑，糖少放' },

  // ---------- 饮品 ----------
  { id: 'r191', name: '豆浆', emoji: '🥛', category: '饮品', tags: ['高蛋白'], price: '经济', crowd: ['teen', 'child'], mealTypes: ['早餐'], why: '现磨的香' },
  { id: 'r192', name: '牛奶', emoji: '🥛', category: '饮品', tags: ['高蛋白'], price: '经济', crowd: ['teen', 'child'], mealTypes: ['早餐'], why: '一天一杯，补钙' },
  { id: 'r193', name: '酸奶', emoji: '🥛', category: '饮品', tags: ['高蛋白'], price: '经济', crowd: ['fitness', 'child'], why: '看配料表，别选加糖的' },
  { id: 'r194', name: '鲜榨橙汁', emoji: '🍊', category: '饮品', tags: ['清淡'], price: '普通', crowd: ['child', 'middle'], why: '别滤渣，纤维在里面' },
  { id: 'r195', name: '柠檬水', emoji: '🍋', category: '饮品', tags: ['清淡', '减脂'], price: '经济', crowd: ['fitness', 'chronic', 'middle'], why: '不加糖才有意义' },
  { id: 'r196', name: '银耳雪梨汤', emoji: '🍐', category: '饮品', tags: ['清淡'], price: '经济', crowd: ['elder', 'pregnant', 'middle'], why: '润嗓，秋冬常备' },
  { id: 'r197', name: '红糖姜茶', emoji: '🫚', category: '饮品', tags: [], price: '经济', crowd: ['pregnant'], why: '经期和受凉时喝' },
  { id: 'r198', name: '菊花茶', emoji: '🌼', category: '饮品', tags: ['清淡'], price: '经济', crowd: ['middle'], why: '熬夜后来一杯' },
  { id: 'r199', name: '大麦茶', emoji: '🌾', category: '饮品', tags: ['清淡'], price: '经济', crowd: ['chronic', 'elder', 'middle'], why: '解腻，不含咖啡因' },
  { id: 'r200', name: '无糖气泡水', emoji: '🫧', category: '饮品', tags: ['减脂'], price: '经济', crowd: ['fitness'], why: '想喝甜的时候拿它顶一下' },

  // ---------- 幼儿（1-3 岁）：一律不加盐糖，做法以泥、糊、羹为主 ----------
  { id: 'r201', name: '南瓜米糊', emoji: '🎃', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['toddler'], mealTypes: ['早餐'], why: '无盐无糖，六个月后就能吃' },
  { id: 'r202', name: '胡萝卜泥', emoji: '🥕', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['toddler'], why: '蒸透打泥，一点油帮吸收' },
  { id: 'r203', name: '西兰花泥', emoji: '🥦', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['toddler'], why: '断生就打，别煮黄' },
  { id: 'r204', name: '鸡肉泥', emoji: '🍗', category: '中餐', tags: ['高蛋白'], price: '经济', crowd: ['toddler'], why: '鸡胸煮熟撕丝再打' },
  { id: 'r205', name: '鳕鱼泥', emoji: '🐟', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['toddler'], why: '刺少，蒸熟压碎' },
  { id: 'r206', name: '蛋黄泥', emoji: '🥚', category: '中餐', tags: ['高蛋白'], price: '经济', crowd: ['toddler'], why: '从四分之一个开始加' },
  { id: 'r207', name: '猪肝泥', emoji: '🥩', category: '中餐', tags: ['高蛋白'], price: '经济', crowd: ['toddler'], why: '补铁，一周一两次就够' },
  { id: 'r208', name: '紫薯泥', emoji: '🍠', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['toddler'], why: '自带甜味，不用加糖' },
  { id: 'r209', name: '蔬菜粥', emoji: '🥬', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['toddler'], mealTypes: ['早餐'], why: '米煮烂再下菜末' },
  { id: 'r210', name: '豆腐羹', emoji: '🥣', category: '中餐', tags: ['高蛋白'], price: '经济', crowd: ['toddler'], why: '内酯豆腐最嫩' },
  { id: 'r211', name: '番茄牛肉末', emoji: '🍅', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['toddler'], why: '牛肉剁碎，番茄提味' },
  { id: 'r212', name: '虾滑', emoji: '🦐', category: '中餐', tags: ['高蛋白'], price: '普通', crowd: ['toddler'], why: '剁泥摔打上劲，煮到浮起' },
  { id: 'r213', name: '小米油', emoji: '🥣', category: '中餐', tags: ['清淡'], price: '经济', crowd: ['toddler'], mealTypes: ['早餐'], why: '粥面那层米油最养人' },
  { id: 'r214', name: '苹果泥', emoji: '🍎', category: '甜品', tags: ['清淡'], price: '经济', crowd: ['toddler'], mealTypes: ['早餐'], why: '刮着吃，别榨成汁' },
  { id: 'r215', name: '香蕉燕麦糊', emoji: '🍌', category: '西餐', tags: ['清淡'], price: '经济', crowd: ['toddler'], mealTypes: ['早餐'], why: '香蕉压泥拌燕麦' },
  { id: 'r216', name: '鸡蛋羹', emoji: '🥚', category: '中餐', tags: ['高蛋白'], price: '经济', crowd: ['toddler'], why: '蛋水一比一点五，过筛更滑' },
  { id: 'r217', name: '三文鱼松', emoji: '🐟', category: '中餐', tags: ['高蛋白'], price: '丰盛', crowd: ['toddler'], why: '炒干打松，拌粥拌面都行' },
  { id: 'r218', name: '南瓜发糕', emoji: '🎃', category: '面食', tags: ['清淡'], price: '经济', crowd: ['toddler'], mealTypes: ['早餐'], why: '无糖版，蒸出来松软' },
  { id: 'r219', name: '蔬菜面片', emoji: '🥬', category: '面食', tags: ['清淡'], price: '经济', crowd: ['toddler'], why: '面片揪小一点好咽' },
  { id: 'r220', name: '鸡肉粥', emoji: '🍗', category: '中餐', tags: ['高蛋白'], price: '经济', crowd: ['toddler'], mealTypes: ['早餐'], why: '鸡肉撕成丝再煮' }
]

/** 补默认值。原始数据只写「跟默认不一样」的部分，这里统一兜底 */
function normalize(item) {
  return {
    tags: [],
    mealTypes: ['午餐', '晚餐'],
    eatTypes: ['自己做'],
    ...item
  }
}

const RECIPES = RAW.map(normalize)

/** 按 id 取一道推荐菜；找不到返回 null */
function getRecipe(id) {
  if (!id) return null
  return RECIPES.find(item => item.id === id) || null
}

/** 人群 key → 中文标签。认不出来就原样返回，别让界面出现 undefined */
function crowdLabel(key) {
  const found = CROWDS.find(item => item.key === key)
  return found ? found.label : String(key || '')
}

/** 一道菜的人群标签文案，多个用顿号连 */
function crowdText(dish) {
  const list = Array.isArray(dish && dish.crowd) ? dish.crowd : []
  return list.map(crowdLabel).filter(Boolean).join('、')
}

module.exports = { CROWDS, RECIPES, getRecipe, crowdLabel, crowdText }
