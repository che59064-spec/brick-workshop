from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
ROOT=Path(__file__).resolve().parents[1]
PROJECT=ROOT.parent
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',28)
small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',20)
canvas=Image.new('RGB',(1440,1640),'#f2f0e7')
draw=ImageDraw.Draw(canvas)
draw.text((40,25),'视频截图与 Blender 研究初稿对照',font=font,fill='#303831')
draw.text((40,72),'仅裁切与等比缩放；原型仍有形体、连接和运动路径差异。',font=small,fill='#73796b')
items=[
 ('视频参考 · 20 秒',PROJECT/'research/video-frame-20.png',(50,360,715,910),(35,145,705,740)),
 ('Blender · 飞机研究初稿',ROOT/'output/aircraft.png',(15,160,895,950),(735,145,1405,740)),
 ('视频参考 · 26 秒',PROJECT/'research/video-frame-26.png',(75,180,660,1090),(35,850,705,1515)),
 ('Blender · 人形研究初稿',ROOT/'output/humanoid.png',(65,40,850,1070),(735,850,1405,1515)),
]
for title,path,crop,rect in items:
    draw.text((rect[0],rect[1]-39),title,font=font,fill='#303831')
    image=Image.open(path).convert('RGB').crop(crop)
    fitted=ImageOps.contain(image,(rect[2]-rect[0],rect[3]-rect[1]),Image.Resampling.LANCZOS)
    draw.rectangle(rect,fill='#deddd1')
    canvas.paste(fitted,(rect[0]+(rect[2]-rect[0]-fitted.width)//2,rect[1]+(rect[3]-rect[1]-fitted.height)//2))
draw.text((40,770),'需继续校正：侧模块长度、紧凑翼形、机鼻框架位置与隐藏连接。',font=small,fill='#626b59')
draw.text((40,1550),'已改进：真实零件底腔、孔洞、铰链、格栅、暗灰塑料与软阴影。',font=small,fill='#626b59')
draw.text((40,1585),'来源：野生砖块视频截帧；零件几何：LDraw 正式库。',font=small,fill='#858b7b')
output=ROOT/'output/reference_comparison.jpg'
canvas.save(output,quality=94,subsampling=0)
with Image.open(output) as image:image.verify()
print(output)
