import importlib.machinery
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent
path=ROOT/'scripts/source-audit'
if not path.exists():path=ROOT/'scripts/release-check'
loader=importlib.machinery.SourceFileLoader('source_audit_test',str(path))
spec=importlib.util.spec_from_loader(loader.name,loader)
audit=importlib.util.module_from_spec(spec)
loader.exec_module(audit)

class SourceAuditTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def write(self,name,text):
  p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);return p
 def errors(self):return audit.inspect(self.root,strict=True)[1]
 def test_clean_text(self):
  self.write('README.md','A small app.');self.assertEqual(self.errors(),[])
 def test_secret_not_echoed(self):
  token='sk-'+'x'*30;self.write('settings.ts',token);errors=self.errors()
  self.assertTrue(errors);self.assertNotIn(token,str(errors))
 def test_empty_env_only(self):
  self.write('.env.example','MODEL_API_KEY=\n');self.assertEqual(self.errors(),[])
  self.write('.env.example','MODEL_API_KEY=not-a-real-key\n');self.assertTrue(self.errors())
 def test_media_and_embedded_images(self):
  self.write('capture.png','not even binary');self.assertTrue(self.errors())
  (self.root/'capture.png').unlink();self.write('request.json','data:image/png;base64,'+'A'*128);self.assertTrue(self.errors())
 def test_runtime_directory(self):
  self.write('data/local.json','{}');self.assertTrue(self.errors())
 def test_external_symlink(self):
  (self.root/'alias').symlink_to(self.root.parent);self.assertTrue(self.errors())
 def test_tracked_ignored_private_file(self):
  subprocess.run(['git','init','-q',str(self.root)],check=True)
  self.write('.gitignore','.local/\n');self.write('.local/log.txt','private trial')
  subprocess.run(['git','add','-f','.local/log.txt'],cwd=self.root,check=True)
  self.assertTrue(audit.inspect(self.root)[1])
 def test_broken_document_link(self):
  self.write('README.md','[guide](missing.md)');self.assertTrue(self.errors())

if __name__=='__main__':unittest.main()
