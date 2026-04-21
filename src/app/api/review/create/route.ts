import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { runReviewEngine } from '@/lib/reviewEngine'
import { AustralianState, ContractType } from '@/types'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  let reviewId = ''
  let storagePath = ''

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profile } = await adminSupabase
      .from('user_profiles')
      .select('firm_id')
      .eq('id', user.id)
      .single()

    if (!profile?.firm_id) {
      return NextResponse.json({ error: 'No firm found' }, { status: 400 })
    }

    const body = await request.json()
    storagePath = body.storagePath as string
    if (!storagePath) return NextResponse.json({ error: 'No storage path provided' }, { status: 400 })

    const { fileName, fileSizeBytes, state, contractType } = body

    // Create review record
    const { data: review, error: reviewError } = await adminSupabase
      .from('reviews')
      .insert({
        firm_id: profile.firm_id,
        user_id: user.id,
        status: 'processing',
        state,
        contract_type: contractType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
        storage_path: storagePath,
      })
      .select()
      .single()

    if (reviewError) throw reviewError
    reviewId = review.id

    // Get signed URL (same pattern as Conveyancing Crew)
    const { data: signedData, error: signedError } = await adminSupabase
      .storage
      .from('contracts')
      .createSignedUrl(storagePath, 60)

    if (signedError || !signedData?.signedUrl) {
      throw new Error('Could not access document in storage')
    }

    console.log(`[ConveyIQ] Fetching document from storage...`)

    // Fetch via signed URL
    const pdfRes = await fetch(signedData.signedUrl)
    if (!pdfRes.ok) throw new Error('Could not download document from storage')

    const arrayBuf = await pdfRes.arrayBuffer()
    const pdfBuffer = Buffer.from(arrayBuf)

    console.log(`[ConveyIQ] Downloaded ${fileName} (${Math.round(pdfBuffer.length / 1024 / 1024)}MB)`)

    // Run review engine
    const startTime = Date.now()
    const { result, tokensUsed } = await runReviewEngine(
      pdfBuffer,
      state as AustralianState,
      contractType as ContractType
    )
    const processingTime = Date.now() - startTime

    // Save result
    await adminSupabase
      .from('reviews')
      .update({
        status: 'completed',
        result,
        processing_time_ms: processingTime,
        tokens_used: tokensUsed,
        storage_path: null,
        file_deleted_at: new Date().toISOString(),
      })
      .eq('id', reviewId)

    // Delete from storage
    await adminSupabase.storage.from('contracts').remove([storagePath])

    // Log usage
    const costAud = parseFloat(((tokensUsed / 1000000) * 4.5).toFixed(4))
    await adminSupabase.from('usage_records').insert({
      firm_id: profile.firm_id,
      user_id: user.id,
      review_id: reviewId,
      type: 'review',
      tokens_used: tokensUsed,
      cost_aud: costAud,
    })

    // Increment free reviews
    const { data: firm } = await adminSupabase
      .from('firms')
      .select('subscription_tier, free_reviews_used')
      .eq('id', profile.firm_id)
      .single()

    if (firm?.subscription_tier === 'free') {
      await adminSupabase
        .from('firms')
        .update({ free_reviews_used: (firm.free_reviews_used || 0) + 1 })
        .eq('id', profile.firm_id)
    }

    console.log(`[ConveyIQ] ✅ Review ${reviewId} completed in ${(processingTime / 1000).toFixed(1)}s`)
    return NextResponse.json({ success: true, reviewId })

  } catch (err: any) {
    console.error('[ConveyIQ] Review error:', err?.message || err)
    if (reviewId) {
      const adminSupabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      await adminSupabase
        .from('reviews')
        .update({ status: 'failed', error_message: err.message })
        .eq('id', reviewId)
      if (storagePath) {
        await adminSupabase.storage.from('contracts').remove([storagePath]).catch(() => {})
      }
    }
    return NextResponse.json({ error: err?.message || 'Review failed' }, { status: 500 })
  }
}
