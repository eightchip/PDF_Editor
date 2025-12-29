import { NextRequest, NextResponse } from 'next/server';
import { encrypt } from 'node-qpdf2';

/**
 * PDFにパスワード保護を追加するAPIルート
 * クライアント側で生成されたPDFを受け取り、パスワード保護を追加して返す
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get('pdf') as File;
    const password = formData.get('password') as string;
    const permissionsJson = formData.get('permissions') as string;

    if (!pdfFile) {
      return NextResponse.json(
        { error: 'PDFファイルが提供されていません' },
        { status: 400 }
      );
    }

    // パスワードが空の場合は、保護なしで元のPDFを返す
    if (!password || password.trim() === '') {
      const pdfBytes = await pdfFile.arrayBuffer();
      return new NextResponse(pdfBytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="document.pdf"`,
        },
      });
    }

    // パーミッションをパース
    let permissions: any = {};
    if (permissionsJson) {
      try {
        permissions = JSON.parse(permissionsJson);
      } catch (e) {
        console.warn('パーミッションのパースに失敗:', e);
      }
    }

    // PDFファイルを読み込む
    const pdfBytes = await pdfFile.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfBytes);

    // 一時ファイルとして保存（node-qpdf2はファイルパスを必要とする）
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const inputPath = path.join(tempDir, `input_${timestamp}.pdf`);
    const outputPath = path.join(tempDir, `output_${timestamp}.pdf`);
    
    try {
      // 入力ファイルを書き込む
      fs.writeFileSync(inputPath, pdfBuffer);
    } catch (writeError) {
      console.error('一時ファイルの書き込みエラー:', writeError);
      return NextResponse.json(
        { error: '一時ファイルの作成に失敗しました: ' + (writeError instanceof Error ? writeError.message : String(writeError)) },
        { status: 500 }
      );
    }

    // 権限を設定
    const restrictions: any = {};
    // printは'full', 'low', 'none'のいずれかを指定
    if (permissions.printing === 'none') {
      restrictions.print = 'none';
    } else if (permissions.printing === 'lowResolution') {
      restrictions.print = 'low';
    } else {
      restrictions.print = 'full';
    }
    // modifyは'all', 'annotate', 'assembly', 'form', 'none'のいずれかを指定
    if (permissions.modifying) {
      restrictions.modify = 'all';
    } else {
      restrictions.modify = 'none';
    }
    // extract（コピー）は'y'または'n'を指定
    restrictions.extract = permissions.copying ? 'y' : 'n';
    // annotate（注釈）は'y'または'n'を指定
    restrictions.annotate = permissions.annotating ? 'y' : 'n';
    // form（フォーム入力）は'y'または'n'を指定
    restrictions.form = permissions.fillingForms ? 'y' : 'n';
    // accessibility（アクセシビリティ）は'y'または'n'を指定
    restrictions.accessibility = permissions.contentAccessibility ? 'y' : 'n';
    // assemble（文書の組み立て）は'y'または'n'を指定
    restrictions.assemble = permissions.documentAssembly ? 'y' : 'n';

    try {
      // qpdfがインストールされているか確認
      const { execSync } = await import('child_process');
      const path = await import('path');
      const os = await import('os');
      const fs = await import('fs');
      const platform = os.platform();
      
      // 環境変数からqpdfのパスを取得（Vercelなどで設定可能）
      const qpdfPathFromEnv = process.env.QPDF_PATH;
      
      // プラットフォームに応じたqpdfの検出
      let qpdfPath: string | null = null;
      const possiblePaths: string[] = [];
      
      // 環境変数で指定されたパスを最初に試す（優先度最高）
      if (qpdfPathFromEnv) {
        possiblePaths.push(qpdfPathFromEnv);
      }
      
      if (platform === 'win32') {
        // Windows環境
        possiblePaths.push(
          'qpdf', // PATHにある場合
          path.join('C:', 'Program Files', 'qpdf 12.2.0', 'bin', 'qpdf.exe'),
          path.join('C:', 'Program Files', 'qpdf', 'bin', 'qpdf.exe'),
          path.join('C:', 'qpdf', 'bin', 'qpdf.exe'),
        );
      } else {
        // Linux/Unix環境（Vercelなど）
        possiblePaths.push(
          'qpdf', // PATHにある場合（aptでインストールされた場合）
          '/usr/bin/qpdf',
          '/usr/local/bin/qpdf',
        );
      }
      
      for (const testPath of possiblePaths) {
        try {
          // 環境変数で指定されたパスの場合、直接試す
          if (qpdfPathFromEnv && testPath === qpdfPathFromEnv) {
            // 環境変数で指定されたパスを直接使用
            if (testPath === 'qpdf') {
              // 'qpdf'が指定されている場合、PATHから検索
              execSync('qpdf --version', { stdio: 'ignore', timeout: 5000 });
              qpdfPath = 'qpdf';
              break;
            } else if (fs.existsSync(testPath)) {
              // 直接パスが指定されている場合
              execSync(`"${testPath}" --version`, { stdio: 'ignore', timeout: 5000 });
              qpdfPath = testPath;
              break;
            } else {
              // パスが存在しない場合でも、コマンドとして試す
              try {
                execSync(`"${testPath}" --version`, { stdio: 'ignore', timeout: 5000 });
                qpdfPath = testPath;
                break;
              } catch (e) {
                // 次のパスを試す
                continue;
              }
            }
          } else if (testPath === 'qpdf') {
            // PATHから検索
            execSync('qpdf --version', { stdio: 'ignore', timeout: 5000 });
            qpdfPath = 'qpdf';
            break;
          } else {
            // 直接パスを確認
            if (fs.existsSync(testPath)) {
              execSync(`"${testPath}" --version`, { stdio: 'ignore', timeout: 5000 });
              qpdfPath = testPath;
              break;
            }
          }
        } catch (e) {
          // 次のパスを試す
          continue;
        }
      }

      if (!qpdfPath) {
        const isVercel = process.env.VERCEL === '1';
        const errorMessage = platform === 'win32'
          ? 'qpdfがインストールされていません。\n\n' +
            'Windowsでのインストール方法:\n' +
            '1. Chocolateyを使用する場合（管理者権限が必要）:\n' +
            '   choco install qpdf\n\n' +
            '2. 手動インストール:\n' +
            '   https://qpdf.sourceforge.io/ からダウンロードしてインストールしてください。\n\n' +
            'インストール後、PATH環境変数にqpdfのパスが追加されていることを確認してください。'
          : isVercel
          ? 'qpdfがインストールされていません。\n\n' +
            'Vercel環境での設定方法:\n' +
            '1. Vercelのプロジェクト設定で環境変数 QPDF_PATH を設定してください。\n' +
            '2. または、Vercelのビルドコマンドでqpdfをインストールしてください。\n\n' +
            '詳細: https://qpdf.sourceforge.io/\n' +
            'Vercelでの設定: https://vercel.com/docs/concepts/projects/environment-variables'
          : 'qpdfがインストールされていません。\n\n' +
            'Linux環境でのインストール方法:\n' +
            '1. aptを使用する場合:\n' +
            '   sudo apt-get update && sudo apt-get install -y qpdf\n\n' +
            '2. または、環境変数 QPDF_PATH でqpdfのパスを指定してください。\n\n' +
            '詳細: https://qpdf.sourceforge.io/';
        console.error('qpdf検出エラー:', errorMessage);
        console.error('プラットフォーム:', platform);
        console.error('Vercel環境:', isVercel);
        console.error('環境変数 QPDF_PATH:', qpdfPathFromEnv || '未設定');
        console.error('試行したパス:', possiblePaths);
        throw new Error(errorMessage);
      }

      // qpdfPathが直接パスの場合、binディレクトリをPATHに追加
      const originalPath = process.env.PATH;
      if (qpdfPath && qpdfPath !== 'qpdf') {
        const qpdfDir = path.dirname(qpdfPath);
        process.env.PATH = (originalPath || '') + path.delimiter + qpdfDir;
        console.log('qpdfのPATHを設定しました:', qpdfDir);
      }

      try {
        // PDFを暗号化
        await encrypt({
          input: inputPath,
          output: outputPath,
          password: password,
          keyLength: 256,
          restrictions: restrictions,
        });
      } finally {
        // PATHを元に戻す
        if (originalPath !== undefined) {
          process.env.PATH = originalPath;
        }
      }

      // 保護されたPDFを読み込む
      const protectedPdfBuffer = fs.readFileSync(outputPath);

      // 一時ファイルを削除
      try {
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch (cleanupError) {
        console.warn('一時ファイルの削除に失敗しました:', cleanupError);
        // 削除エラーは無視（後でOSが自動削除する）
      }

      return new NextResponse(protectedPdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="protected.pdf"`,
        },
      });
    } catch (encryptError) {
      console.error('PDF暗号化エラー:', encryptError);
      // 一時ファイルをクリーンアップ
      try {
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch (cleanupError) {
        console.warn('一時ファイルの削除に失敗しました:', cleanupError);
      }
      throw encryptError;
    }

  } catch (error) {
    console.error('PDF保護エラー:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('エラー詳細:', {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { 
        error: 'PDF保護に失敗しました: ' + errorMessage,
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

