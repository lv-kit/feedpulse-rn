import { validateFields } from '../validator';
import type { FeedpulseForm } from '../models';

const form: FeedpulseForm = {
  id: 'form', slug: 'form', name: 'Form', type: 'inquiry', version: 1, allowTarget: false,
  blocks: [
    { id: 'email', type: 'email', label: 'Email', required: false, options: [] },
    { id: 'rating', type: 'rating', label: 'Rating', required: false, options: [], min: 2, max: 5 },
  ],
};

test('メールアドレスをサーバーと同じ条件で検証する', () => {
  expect(validateFields(form, { email: ' user@example.com ' })).toEqual({});
  expect(validateFields(form, { email: 'x'.repeat(250) + '@x.co' })).toEqual({ email: 'invalid_email' });
  const limited = { ...form, blocks: [{ ...form.blocks[0]!, maxLength: 5 }] };
  expect(validateFields(limited, { email: ' user@example.com ' })).toEqual({ email: 'too_long' });
});

test('評価値は 1 以上の整数で上限以下とする', () => {
  expect(validateFields(form, { rating: 2.5 })).toEqual({ rating: 'type' });
  expect(validateFields(form, { rating: 0 })).toEqual({ rating: 'out_of_range' });
  expect(validateFields(form, { rating: 1 })).toEqual({ rating: 'out_of_range' });
  expect(validateFields(form, { rating: 6 })).toEqual({ rating: 'out_of_range' });
  expect(validateFields(form, { rating: 5 })).toEqual({});
});
