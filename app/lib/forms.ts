/**
 * PDFフォームフィールドの操作
 */

import { PDFDocument, PDFForm, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFButton } from 'pdf-lib';

export type FormFieldType = 'text' | 'checkbox' | 'dropdown' | 'radio' | 'button';

export interface FormField {
  id: string;
  name: string;
  type: FormFieldType;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | boolean | string[];
  defaultValue?: string | boolean | string[];
  required?: boolean;
  readOnly?: boolean;
  // 計算フィールド用
  calculationScript?: string;
  // テキストフィールド用
  maxLength?: number;
  // ドロップダウン用
  options?: string[];
}

/**
 * PDFからフォームフィールドを抽出
 */
export async function extractFormFields(pdfDoc: PDFDocument): Promise<FormField[]> {
  const form = pdfDoc.getForm();
  const fields: FormField[] = [];
  const pages = pdfDoc.getPages();

  // フォームフィールドを取得
  const formFields = form.getFields();
  
  for (const field of formFields) {
    const fieldName = field.getName();
    const fieldType = field.constructor.name;
    
    // フィールドがどのページにあるか判定（簡易版：最初のページに仮定）
    // 実際には、フィールドの座標からページを判定する必要がある
    let pageNumber = 1;
    let x = 0;
    let y = 0;
    let width = 100;
    let height = 20;

    try {
      // フィールドの座標を取得（可能な場合）
      if (fieldType.includes('TextField')) {
        const textField = field as PDFTextField;
        const acroField = textField.acroField;
        // pdf-libでは、rectプロパティを直接アクセスするか、getRect()メソッドを使用
        // 型安全性のため、anyでキャストしてアクセス
        const rect = (acroField as any).rect || (acroField as any).getRect?.();
        if (rect && typeof rect === 'object') {
          x = rect.x || rect[0] || 0;
          y = rect.y || rect[1] || 0;
          width = rect.width || (rect[2] ? rect[2] - x : 100);
          height = rect.height || (rect[3] ? rect[3] - y : 20);
        }
      } else if (fieldType.includes('CheckBox')) {
        const checkBox = field as PDFCheckBox;
        const acroField = checkBox.acroField;
        const rect = (acroField as any).rect || (acroField as any).getRect?.();
        if (rect && typeof rect === 'object') {
          x = rect.x || rect[0] || 0;
          y = rect.y || rect[1] || 0;
          width = rect.width || (rect[2] ? rect[2] - x : 100);
          height = rect.height || (rect[3] ? rect[3] - y : 20);
        }
      } else if (fieldType.includes('Dropdown')) {
        const dropdown = field as PDFDropdown;
        const acroField = dropdown.acroField;
        const rect = (acroField as any).rect || (acroField as any).getRect?.();
        if (rect && typeof rect === 'object') {
          x = rect.x || rect[0] || 0;
          y = rect.y || rect[1] || 0;
          width = rect.width || (rect[2] ? rect[2] - x : 100);
          height = rect.height || (rect[3] ? rect[3] - y : 20);
        }
      }
    } catch (e) {
      console.warn('フィールド座標の取得に失敗:', fieldName, e);
    }

    // ページ番号を判定（座標から）
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width: pageWidth, height: pageHeight } = page.getSize();
      // 簡易判定：Y座標がページの範囲内にあるか
      if (y >= 0 && y <= pageHeight) {
        pageNumber = i + 1;
        break;
      }
    }

    let value: string | boolean | string[] = '';
    let defaultValue: string | boolean | string[] | undefined;
    let readOnly = false;
    let required = false;
    let maxLength: number | undefined;
    let options: string[] | undefined;

    if (fieldType.includes('TextField')) {
      const textField = field as PDFTextField;
      value = textField.getText() || '';
      // getDefaultValue()は存在しないため、デフォルト値は取得しない
      defaultValue = undefined;
      readOnly = textField.isReadOnly();
      required = textField.isRequired();
      maxLength = textField.getMaxLength();
    } else if (fieldType.includes('CheckBox')) {
      const checkBox = field as PDFCheckBox;
      value = checkBox.isChecked();
      // getDefaultValue()は存在しないため、デフォルト値は取得しない
      defaultValue = undefined;
      readOnly = checkBox.isReadOnly();
      required = checkBox.isRequired();
    } else if (fieldType.includes('Dropdown')) {
      const dropdown = field as PDFDropdown;
      value = dropdown.getSelected() || [];
      // getDefaultValue()は存在しないため、デフォルト値は取得しない
      defaultValue = undefined;
      readOnly = dropdown.isReadOnly();
      required = dropdown.isRequired();
      options = dropdown.getOptions();
    } else if (fieldType.includes('RadioGroup')) {
      const radioGroup = field as PDFRadioGroup;
      value = radioGroup.getSelected() || '';
      // getDefaultValue()は存在しないため、デフォルト値は取得しない
      defaultValue = undefined;
      readOnly = radioGroup.isReadOnly();
      required = radioGroup.isRequired();
      options = radioGroup.getOptions();
    }

    const type: FormFieldType = 
      fieldType.includes('TextField') ? 'text' :
      fieldType.includes('CheckBox') ? 'checkbox' :
      fieldType.includes('Dropdown') ? 'dropdown' :
      fieldType.includes('RadioGroup') ? 'radio' :
      fieldType.includes('Button') ? 'button' : 'text';

    fields.push({
      id: fieldName,
      name: fieldName,
      type,
      pageNumber,
      x,
      y,
      width,
      height,
      value,
      defaultValue,
      required,
      readOnly,
      maxLength,
      options,
    });
  }

  return fields;
}

/**
 * PDFフォームに値を設定
 */
export async function setFormFieldValues(
  pdfDoc: PDFDocument,
  fieldValues: Record<string, string | boolean | string[]>
): Promise<void> {
  const form = pdfDoc.getForm();
  
  for (const [fieldName, value] of Object.entries(fieldValues)) {
    try {
      const field = form.getField(fieldName);
      const fieldType = field.constructor.name;

      if (fieldType.includes('TextField')) {
        const textField = field as PDFTextField;
        textField.setText(String(value));
      } else if (fieldType.includes('CheckBox')) {
        const checkBox = field as PDFCheckBox;
        if (typeof value === 'boolean') {
          if (value) {
            checkBox.check();
          } else {
            checkBox.uncheck();
          }
        }
      } else if (fieldType.includes('Dropdown')) {
        const dropdown = field as PDFDropdown;
        if (Array.isArray(value)) {
          dropdown.select(value);
        } else {
          dropdown.select([String(value)]);
        }
      } else if (fieldType.includes('RadioGroup')) {
        const radioGroup = field as PDFRadioGroup;
        radioGroup.select(String(value));
      }
    } catch (e) {
      console.warn(`フィールド ${fieldName} の設定に失敗:`, e);
    }
  }
}

/**
 * 計算フィールドのスクリプトを実行
 * 例: 合計 = 項目1 + 項目2 + 項目3
 *     税額 = 小計 * 税率
 *     合計 = 小計 + 税額
 */
export function calculateFormFields(
  fields: FormField[],
  fieldValues: Record<string, string | boolean | string[]>
): Record<string, string | boolean | string[]> {
  const calculatedValues: Record<string, string | boolean | string[]> = { ...fieldValues };

  // 計算スクリプトを実行
  for (const field of fields) {
    if (field.calculationScript) {
      try {
        const result = evaluateCalculationScript(field.calculationScript, fieldValues, fields);
        calculatedValues[field.name] = result;
      } catch (e) {
        console.warn(`計算フィールド ${field.name} の計算に失敗:`, e);
      }
    }
  }

  return calculatedValues;
}

/**
 * 計算スクリプトを評価
 * 例: "sum(field1, field2, field3)"
 *     "multiply(subtotal, 0.1)" (10%の税率)
 *     "add(subtotal, tax)"
 */
function evaluateCalculationScript(
  script: string,
  fieldValues: Record<string, string | boolean | string[]>,
  fields: FormField[]
): string {
  // 簡易的な計算スクリプト評価
  // 実際のPDFではJavaScriptを使用するが、ここでは簡易版を実装
  
  // 数値フィールドの値を取得
  const getNumericValue = (fieldName: string): number => {
    const value = fieldValues[fieldName];
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/[^\d.-]/g, ''));
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };

  // 関数の定義
  const functions: Record<string, (...args: number[]) => number> = {
    sum: (...args) => args.reduce((a, b) => a + b, 0),
    multiply: (a, b) => a * b,
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    divide: (a, b) => (b !== 0 ? a / b : 0),
  };

  // スクリプトをパースして実行
  // 簡易版: "sum(field1, field2)" のような形式を想定
  const functionMatch = script.match(/(\w+)\((.*?)\)/);
  if (functionMatch) {
    const funcName = functionMatch[1];
    const argsStr = functionMatch[2];
    const args = argsStr.split(',').map(arg => {
      const trimmed = arg.trim();
      // フィールド名か数値か判定
      if (fieldValues.hasOwnProperty(trimmed)) {
        return getNumericValue(trimmed);
      } else {
        const num = parseFloat(trimmed);
        return isNaN(num) ? 0 : num;
      }
    });

    if (functions[funcName]) {
      const result = functions[funcName](...args);
      return result.toFixed(2);
    }
  }

  // 単純な数式の場合（例: "field1 + field2"）
  let expression = script;
  for (const field of fields) {
    const value = getNumericValue(field.name);
    expression = expression.replace(new RegExp(`\\b${field.name}\\b`, 'g'), String(value));
  }

  try {
    // 安全な評価（簡易版）
    const result = Function(`"use strict"; return (${expression})`)();
    return typeof result === 'number' ? result.toFixed(2) : String(result);
  } catch (e) {
    console.warn('計算式の評価に失敗:', script, e);
    return '0';
  }
}

/**
 * 一般的な計算フィールドの設定
 * 請求書・見積書でよく使われる計算式
 */
export function setupCommonCalculations(fields: FormField[]): FormField[] {
  // フィールド名から自動的に計算式を推測
  const updatedFields = fields.map(field => {
    const name = field.name.toLowerCase();
    
    // 合計フィールド
    if (name.includes('total') || name.includes('合計')) {
      // 項目1, 項目2, 項目3などの合計を計算
      const itemFields = fields.filter(f => 
        (f.name.toLowerCase().includes('item') || 
         f.name.toLowerCase().includes('項目') ||
         f.name.toLowerCase().includes('amount') ||
         f.name.toLowerCase().includes('金額')) &&
        f.type === 'text'
      );
      if (itemFields.length > 0) {
        field.calculationScript = `sum(${itemFields.map(f => f.name).join(', ')})`;
      }
    }
    
    // 税額フィールド
    if (name.includes('tax') || name.includes('税額') || name.includes('消費税')) {
      // 小計 * 税率
      const subtotalField = fields.find(f => 
        (f.name.toLowerCase().includes('subtotal') || 
         f.name.toLowerCase().includes('小計')) &&
        f.type === 'text'
      );
      const taxRateField = fields.find(f => 
        (f.name.toLowerCase().includes('taxrate') || 
         f.name.toLowerCase().includes('税率')) &&
        f.type === 'text'
      );
      if (subtotalField && taxRateField) {
        field.calculationScript = `multiply(${subtotalField.name}, ${taxRateField.name})`;
      } else if (subtotalField) {
        // デフォルト税率10%
        field.calculationScript = `multiply(${subtotalField.name}, 0.1)`;
      }
    }
    
    // 合計（小計 + 税額）
    if ((name.includes('grandtotal') || name.includes('総計')) && 
        !field.calculationScript) {
      const subtotalField = fields.find(f => 
        (f.name.toLowerCase().includes('subtotal') || 
         f.name.toLowerCase().includes('小計')) &&
        f.type === 'text'
      );
      const taxField = fields.find(f => 
        (f.name.toLowerCase().includes('tax') || 
         f.name.toLowerCase().includes('税額')) &&
        f.type === 'text'
      );
      if (subtotalField && taxField) {
        field.calculationScript = `add(${subtotalField.name}, ${taxField.name})`;
      }
    }

    return field;
  });

  return updatedFields;
}

